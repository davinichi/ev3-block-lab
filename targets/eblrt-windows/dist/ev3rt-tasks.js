import {taskComment} from './ev3rt-comments.js';
// One worker per EBL root. MAIN_TASK supervises shutdown and never runs user code.
export function taskRuntime(roots,messages){
  const n=roots.length,m=Math.max(1,messages.size);
  return `
#define LAB_ROOT_COUNT ${n}
static ID lab_task_ids[LAB_ROOT_COUNT]; /* Dynamic-loader IDs become valid at load time. */
typedef struct { jmp_buf exit; unsigned depth; uint32_t motor_epoch[4]; } lab_context_t;
static lab_context_t lab_contexts[LAB_ROOT_COUNT+1];
static volatile bool lab_stopping;
static volatile bool lab_done[LAB_ROOT_COUNT];
static uint32_t lab_messages[${m}],lab_ack[LAB_ROOT_COUNT];
static int lab_owner[4]={-1,-1,-1,-1};
static uint32_t lab_epoch[4];
static int lab_self(void) {
    ID id=0; if (get_tid(&id)!=E_OK) { for (;;) {} }
    for (int i=0;i<LAB_ROOT_COUNT;++i) if (id==lab_task_ids[i]) return i;
    return LAB_ROOT_COUNT;
}
#define lab_exit (lab_contexts[lab_self()].exit)
static void lab_fail(void);
static void lab_lock(void) {
    lab_context_t *ctx=&lab_contexts[lab_self()];
    if (!ctx->depth) {if (wai_sem(LAB_SHARED_SEM)!=E_OK) lab_fail();ctx->depth=1;}
    else ++ctx->depth;
    if (lab_stopping) lab_fail();
}
static void lab_unlock(void) {
    lab_context_t *ctx=&lab_contexts[lab_self()];
    if (!ctx->depth || (--ctx->depth==0 && sig_sem(LAB_SHARED_SEM)!=E_OK)) lab_fail();
}
static void lab_motor_begin(unsigned mask) {
    int self=lab_self();lab_lock();
    for (int i=0;i<4;++i) if (mask&(1U<<i)) {
        /* A competing drive command is a program fault. Stops may cancel any owner. */
        if (lab_owner[i]>=0 && lab_owner[i]!=self) lab_fail();
        lab_owner[i]=self;lab_contexts[self].motor_epoch[i]=lab_epoch[i];
    }
    lab_unlock();
}
static bool lab_motor_valid(unsigned mask) {
    int self=lab_self();bool valid=true;lab_lock();
    for (int i=0;i<4;++i) if ((mask&(1U<<i)) &&
        (lab_owner[i]!=self || lab_contexts[self].motor_epoch[i]!=lab_epoch[i])) valid=false;
    lab_unlock();return valid;
}
static void lab_motor_cancel(unsigned mask) {
    for (int i=0;i<4;++i) if (mask&(1U<<i)) {lab_owner[i]=-1;++lab_epoch[i];}
}
static float lab_load(float *value) { lab_lock();float v=*value;lab_unlock();return v; }
static void lab_store(float *value,float v) { lab_lock();*value=v;lab_unlock(); }
static void lab_add(float *value,float v);
static void lab_check(ER result);
static void lab_poll(void);
static void lab_send(int message,bool wait) {
    uint32_t sent;lab_lock();
    if (lab_messages[message]>=2147483645U) lab_fail();
    sent=++lab_messages[message];lab_unlock();
    if (!wait) return;
    for (;;) {
        bool done=true;lab_lock();
        ${roots.map((r,i)=>r.kind==='message'?`if (message==${messages.get(r.message)} && lab_ack[${i}]<sent) done=false;`:'').filter(Boolean).join('\n        ')}
        lab_unlock();if (done) break;lab_poll();
    }
}
`;
}

export function taskEntry(roots,bodies,conditions,annotate=comment=>comment){
  return roots.map((r,i)=>{
    let body=bodies[i];
    if(r.kind!=='start'){
      // The exporter supplies a final temporary explicitly; no user identifiers appear here.
      const expr=conditions[i]?.value;
      const code=conditions[i]?.code??'';
      let init='float previous=0;';
      let gate='';
      if(r.kind==='message'){
        init='uint32_t previous=0;';
        gate=`uint32_t observed;lab_lock();observed=lab_messages[${r.messageId}];lab_unlock();\n            if (observed!=previous) {\n${body}\n                previous=observed;lab_lock();lab_ack[${i}]=observed;lab_unlock();\n            }`;
      }else{
        if(r.kind==='changed')init=`float previous;\n        {\n${code}\n            previous=${expr};\n        }`;
        gate=`{\n${code}\n            float observed=${expr};\n            bool fire=${r.kind==='changed'?'observed!=previous':'observed!=0 && previous==0'};\n            previous=observed;\n            if (fire) {\n${body}\n            }\n        }`;
      }
      body=`        ${init}\n        for (;;) {\n            ${gate}\n            lab_wait(20);\n        }`;
    }
    return annotate(taskComment(r,i))+`\nvoid lab_task_${i}(intptr_t exinf) {\n    (void)exinf;\n    /* このタスク専用の終了先を用意します。ほかのタスクの途中へは戻りません。 */\n    if (setjmp(lab_exit)==0) {\n${body}\n    }\n    /* 自分の終了を記録して、EV3RTへ制御を返します。 */\n    lab_done[${i}]=true;\n    ext_tsk();\n}`;
  }).join('\n\n');
}

export function taskSupervisor(roots,init){
  return `void main_task(intptr_t exinf) {
    (void)exinf;
    ${roots.map((_,i)=>`lab_task_ids[${i}]=LAB_TASK_${i};`).join('\n    ')}
    if (setjmp(lab_exit)==0) {
        /* モーター・センサーの種類を設定し、計測の準備をします。 */
${init.split('\n').map(line=>'    '+line).join('\n')}
        /* スタート・イベントに対応する各タスクを起動します。 */
        ${roots.map((_,i)=>`lab_check(act_tsk(LAB_TASK_${i}));`).join('\n        ')}
        /* 作品の処理と並行して、停止要求と位置保持を監督します。 */
        for (;;) {
            if (lab_stopping || ev3_button_is_pressed(BACK_BUTTON)) break;
            lab_hold_tick();
            ${roots.some(r=>r.kind!=='start')?'/* Event listeners keep the application alive until BACK or programEnd. */':`if (${roots.map((_,i)=>`lab_done[${i}]`).join(' && ')}) break;`}
            ER er=tslp_tsk(1000);
            if (er!=E_OK && er!=E_TMOUT) break;
        }
    }
    lab_stopping=true;
    /* 全タスクを終了してからモーターを止め、停止後の再駆動を防ぎます。 */
    for (int i=0;i<LAB_ROOT_COUNT;++i) {
        ER er=ter_tsk(lab_task_ids[i]);(void)er; /* Dormant workers return E_OBJ. */
    }
    /* No locks here: a failed worker may have exited inside a critical section. */
    for (int i=0;i<4;++i) if (lab_motor_mask&(1U<<i)) ev3_motor_stop((motor_port_t)i,true);
    ev3_speaker_stop();
    ext_tsk();
}`;
}

// Keep the single-task backend byte-for-byte stable. Adapt its small shared runtime
// only for native multitasking; replacements fail loudly if the base changes.
export function parallelSource(source,roots,messages,initialization){
  const replace=(from,to)=>{if(!source.includes(from))throw Error('EV3-RT task runtime template mismatch: '+from.slice(0,45));source=source.replace(from,to);};
  replace('static jmp_buf lab_exit;',taskRuntime(roots,messages));
  replace('static void lab_fail(void) { lab_stop(15, true); longjmp(lab_exit, 1); }',`static void lab_fail(void) {
    lab_stopping=true;
    lab_context_t *ctx=&lab_contexts[lab_self()];
    /* The supervisor may be waiting to run its hold tick. Never abandon the semaphore. */
    if(ctx->depth) {ctx->depth=0;ER er=sig_sem(LAB_SHARED_SEM);(void)er;}
    longjmp(lab_exit,1);
}`);
  replace('static void lab_stop(unsigned mask, bool brake) {','static void lab_stop(unsigned mask, bool brake) {\n    lab_lock();lab_motor_cancel(mask);');
  replace('ev3_motor_stop((motor_port_t)i, brake);\n}', 'ev3_motor_stop((motor_port_t)i, brake);\n    lab_unlock();\n}');
  replace('static void lab_poll(void) {','static void lab_poll(void) {\n    if (lab_stopping) lab_fail();');
  replace('static float lab_number(float n) { if (!isfinite(n)) lab_fail(); return n; }',`static float lab_number(float n) { if (!isfinite(n)) lab_fail(); return n; }
static void lab_add(float *value,float v) {lab_lock();*value=lab_number(*value+v);lab_unlock();}
static int lab_gyro_offset(int port) {lab_lock();int value=lab_gyro_zero[port];lab_unlock();return value;}
static void lab_finish(unsigned mask) {lab_lock();if (lab_motor_valid(mask)) lab_stop(mask,true);lab_unlock();}`);
  replace('static void lab_wait(float milliseconds)',`static float lab_timer_value(void) {lab_lock();SYSTIM start=lab_timer_start;lab_unlock();return lab_elapsed(start)/1000000.0f;}
static void lab_wait(float milliseconds)`);
  replace('static void lab_run(unsigned mask, float speed) {','static void lab_run(unsigned mask, float speed) {\n    lab_lock();');
  replace('    int power=lab_motor_percent(speed);','    int power=lab_motor_percent(speed);\n    if (!power) {lab_stop(mask,true);lab_unlock();return;}\n    lab_motor_begin(mask);');
  replace('lab_check(ev3_motor_set_power((motor_port_t)i, power));\n}', 'lab_check(ev3_motor_set_power((motor_port_t)i, power));\n    lab_unlock();\n}');
  replace('static void lab_rotate(unsigned mask, float speed, float amount) {','static void lab_rotate(unsigned mask, float speed, float amount) {\n    lab_lock();lab_motor_begin(mask);');
  replace('    SYSTIM start; lab_check(get_tim(&start));\n    for (;;) {\n        bool done=true;', '    SYSTIM start; lab_check(get_tim(&start));lab_unlock();\n    for (;;) {\n        if (!lab_motor_valid(mask)) return;\n        bool done=true;');
  replace('    lab_stop(mask, true);\n}', '    lab_finish(mask);\n}');
  replace('static void lab_pair_setup(int left,int right) {','static void lab_pair_setup(int left,int right) {\n    lab_lock();');
  replace('lab_left=left; lab_right=right;', 'lab_left=left; lab_right=right;lab_unlock();');
  replace('static void lab_ramp(int mode,float up,float down) {','static void lab_ramp(int mode,float up,float down) {\n    lab_lock();');
  replace('lab_ramp_mode=mode;lab_ramp_up=up;lab_ramp_down=down;', 'lab_ramp_mode=mode;lab_ramp_up=up;lab_ramp_down=down;lab_unlock();');
  replace('static float lab_shape(float f) {',`static void lab_require_ramp_off(void) {lab_lock();if (lab_ramp_mode) lab_fail();lab_unlock();}
static void lab_timed(unsigned mask,float speed,float seconds) {
    lab_lock();lab_require_ramp_off();
    if (lab_motor_percent(speed)==0 || seconds<=0 || seconds>60) lab_fail();
    lab_run(mask,speed);SYSTIM start;lab_check(get_tim(&start));lab_unlock();
    while (lab_elapsed(start)<seconds*1000000.0) {if (!lab_motor_valid(mask)) return;lab_poll();}
    lab_finish(mask);
}
static bool lab_steer_owned(unsigned mask,int left,int right,int power,int ratio) {
    lab_lock();bool valid=lab_motor_valid(mask);
    if (valid) lab_check(ev3_motor_steer((motor_port_t)left,(motor_port_t)right,power,ratio));
    lab_unlock();return valid;
}
static float lab_shape(int mode,float f) {`);
  replace('return lab_ramp_mode==2 ?', 'return mode==2 ?');
  replace('static void lab_motion(int left,int right,float speed,float turn,float angle,float seconds,int finite) {',`static void lab_motion(int left,int right,float speed,float turn,float angle,float seconds,int finite) {
    lab_lock();int ramp_mode=lab_ramp_mode;float ramp_up=lab_ramp_up,ramp_down=lab_ramp_down;lab_unlock();`);
  replace('unsigned mask=(1U<<left)|(1U<<right);', 'unsigned mask=(1U<<left)|(1U<<right);lab_motor_begin(mask);');
  replace('double elapsed=lab_elapsed(start),progress=', 'if (!lab_motor_valid(mask)) return;\n        double elapsed=lab_elapsed(start),progress=');
  // Remaining ramp references in the finite-motion loop use one immutable snapshot.
  const begin=source.indexOf('static void lab_motion('),end=source.indexOf('static void lab_steering(');
  let motion=source.slice(begin,end);const split=motion.indexOf('    int power=');
  motion=motion.slice(0,split)+motion.slice(split).replaceAll('lab_ramp_mode','ramp_mode').replaceAll('lab_ramp_up','ramp_up').replaceAll('lab_ramp_down','ramp_down').replaceAll('lab_shape(','lab_shape(ramp_mode,');
  source=source.slice(0,begin)+motion+source.slice(end);
  replace('lab_check(ev3_motor_steer((motor_port_t)left,(motor_port_t)right,command,ratio));','if (!lab_steer_owned(mask,left,right,command,ratio)) return;');
  replace('    lab_stop(mask,true);\n}', '    lab_finish(mask);\n}');
  replace('lab_movement_mask();lab_motion(lab_left,lab_right,speed,turn,angle,seconds,finite);','lab_lock();lab_movement_mask();int left=lab_left,right=lab_right;lab_unlock();\n    lab_motion(left,right,speed,turn,angle,seconds,finite);');
  replace('static unsigned lab_movement_mask(void) {', 'static unsigned lab_movement_mask(void) {\n    lab_lock();');
  replace('return (1U<<lab_left)|(1U<<lab_right);', 'unsigned mask=(1U<<lab_left)|(1U<<lab_right);lab_unlock();return mask;');
  replace('    lab_number(value);\n    if (lab_diameter', '    lab_lock();float diameter=lab_diameter,track=lab_track;lab_unlock();\n    lab_number(value);\n    if (lab_diameter');
  const geo=source.indexOf('static float lab_geometry('),geoEnd=source.indexOf('\n}',geo)+2;
  let geometry=source.slice(geo,geoEnd);const start=geometry.indexOf('    lab_number(value);');
  geometry=geometry.slice(0,start)+geometry.slice(start).replaceAll('lab_diameter','diameter').replaceAll('lab_track','track');source=source.slice(0,geo)+geometry+source.slice(geoEnd);
  // Main must remain alive while workers use the dynamically loaded module.
  const main=source.indexOf('\nvoid main_task(intptr_t exinf) {');
  if(main<0)throw Error('EV3-RT main task template mismatch');
  source=source.slice(0,main+1)+taskSupervisor(roots,initialization)+'\n';
  return source;
}
