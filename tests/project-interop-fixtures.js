export const num=n=>({shadow:{type:'math_number',fields:{NUM:n}}});
export const value=b=>({block:b});
export function chain(nodes){let next;for(const b of [...nodes].reverse())next={...b,...(next?{next:{block:next}}:{})};return next;}
export function sharedProject(){
 const variable={id:'common-value',name:'結果'},parameter={id:'common-arg',name:'周波数'};
 const report=fields=>({type:'variables_get',fields:{VAR:fields}});
 const body=[
  {type:'lab_log_start',fields:{NAME:'Common'}},
  {type:'variables_set',fields:{VAR:variable},inputs:{VALUE:value({type:'lab_op_add',inputs:{A:num(1.5),B:num(2)}})}},
  {type:'lab_list_clear',fields:{NAME:'データ'}},
  {type:'lab_list_add',fields:{NAME:'データ'},inputs:{VALUE:value(report(variable))}},
  {type:'lab_text_set',fields:{NAME:'文字'},inputs:{VALUE:value({type:'lab_string_join',inputs:{A:value({type:'lab_string_literal',fields:{TEXT:'値'}}),B:value({type:'lab_string_number',inputs:{VALUE:value(report(variable))}})}})}},
  {type:'lab_log_value',fields:{LABEL:'output'},inputs:{VALUE:value({type:'lab_list_item',fields:{NAME:'データ'},inputs:{INDEX:num(1)}})}},
  {type:'lab_pid_reset',fields:{NAME:'PID1'}},
  {type:'lab_log_value',fields:{LABEL:'pid'},inputs:{VALUE:value({type:'lab_pid',fields:{NAME:'PID1'},inputs:{TARGET:num(10),MEASURED:num(5),KP:num(1),KI:num(0),KD:num(0)}})}},
  {type:'controls_whileUntil',fields:{MODE:'WHILE'},inputs:{BOOL:value({type:'logic_boolean',fields:{BOOL:'FALSE'}}),DO:value({type:'lab_wait',inputs:{SECONDS:num(.02)}})}},
  {type:'procedures_callnoreturn',extraState:{name:'合図',params:['周波数']},inputs:{ARG0:num(440)}},
  {type:'procedures_callnoreturn',extraState:{name:'合図',params:['周波数']},inputs:{ARG0:num(880)}},
  {type:'lab_log_end'}
 ];
 return {format:'spike-block-lab',version:1,name:'CommonProject',language:'standard',workspace:{variables:[variable,parameter],blocks:{languageVersion:0,blocks:[
  {type:'spike_start',id:'common-start',x:30,y:30,next:value(chain(body))},
  {type:'procedures_defnoreturn',id:'common-def',x:400,y:30,fields:{NAME:'合図'},extraState:{params:[parameter]},inputs:{STACK:value({type:'lab_sound_tone',fields:{VOLUME:25},inputs:{FREQUENCY:value({type:'lab_argument',extraState:{name:'周波数',parameterId:'common-arg'},fields:{ARG_NAME:'周波数'}}),MS:num(100)}})}}
 ]}}};
}
export function mixedProject(){const p=sharedProject();p.workspace.blocks.blocks[0].next={block:{type:'lab_motor_absolute',id:'held-motor',fields:{PORT:'E',DIRECTION:'SHORTEST_PATH'},inputs:{SPEED:num(10),POSITION:num(360)},next:p.workspace.blocks.blocks[0].next}};p.workspace.blocks.blocks.push({type:'variables_set',fields:{VAR:{id:'common-value',name:'結果'}},inputs:{VALUE:value({type:'lab_distance',id:'held-value',fields:{PORT:'F'}})}});return p;}
