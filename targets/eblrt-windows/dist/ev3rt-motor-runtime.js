// Public HRP3 APIs only. Software profiles/feedback/hold are generated C, not
// claims that the EV3 standard firmware's controller is reproduced exactly.
export const MOTOR_RUNTIME=String.raw`
static int lab_stop_modes[4],lab_raw_modes[4];
static unsigned lab_running_mask,lab_finite_mask,lab_sync_mask,lab_hold_mask;
static unsigned lab_sync_partners[4];
static int lab_sync_run_right[4]={-1,-1,-1,-1},lab_sync_run_power[4],lab_sync_run_turn[4];
static float lab_speed_targets[4];
static int32_t lab_hold_positions[4];
static SYSTIM lab_hold_clock;
static void lab_motor_stopped(unsigned mask) {
    for(int i=0;i<4;++i)if((mask&(1U<<i))||(lab_sync_run_right[i]>=0&&(mask&(1U<<lab_sync_run_right[i]))))lab_sync_run_right[i]=-1;
    lab_running_mask&=~mask;lab_finite_mask&=~mask;lab_sync_mask&=~mask;lab_hold_mask&=~mask;
    for(int i=0;i<4;++i){if(mask&(1U<<i))lab_sync_partners[i]=0;else lab_sync_partners[i]&=~mask;}
}
static void lab_leave_sync(unsigned mask) {
    unsigned previous=0;for(int i=0;i<4;++i)if(mask&(1U<<i))previous|=lab_sync_partners[i];
    if(previous)lab_stop(previous,true);
}
static void lab_regulated_type(int port) {
    if (lab_raw_modes[port]) {
        lab_check(ev3_motor_config((motor_port_t)port,lab_motor_types[port]));
        lab_raw_modes[port]=0;
    }
}
static ER lab_regulated_write(motor_port_t port,int command) {
    lab_regulated_type(port);lab_hold_mask&=~(1U<<port);
    if(command)lab_running_mask|=1U<<port;else lab_running_mask&=~(1U<<port);
    return ev3_motor_set_power(port,command);
}
static void lab_stop_selected(unsigned mask,int mode) {
    lab_lock();mask&=lab_motor_mask;
    for(int i=0;i<4;++i)if(mask&(1U<<i)) {
        int chosen=mode<0?lab_stop_modes[i]:mode;
        if(chosen==2)lab_regulated_type(i);
        int32_t target=ev3_motor_get_counts((motor_port_t)i);
        lab_stop(1U<<i,chosen!=1);
        if(chosen==2) {
            lab_hold_positions[i]=target;lab_hold_mask|=1U<<i;
        }
    }
    lab_unlock();
}
static void lab_complete(unsigned mask) {
    lab_lock();
    for(int i=0;i<4;++i)if((mask&(1U<<i))&&lab_motor_valid(1U<<i))lab_stop_selected(1U<<i,-1);
    lab_unlock();
}
static void lab_stop_mode(unsigned mask,int mode) {
    if(mode<0||mode>2)lab_fail();lab_lock();
    for(int i=0;i<4;++i)if(mask&(1U<<i))lab_stop_modes[i]=mode;
    lab_unlock();
}
static void lab_run_extended(unsigned mask,float speed) {
    lab_lock();if(speed){lab_motor_begin(mask);lab_leave_sync(mask);}lab_run(mask,speed);
    for(int i=0;i<4;++i)if(mask&(1U<<i))lab_speed_targets[i]=speed;
    lab_unlock();
}
static void lab_raw_power(unsigned mask,float value) {
    int power=lab_motor_percent(value);lab_lock();
    if(!power){lab_stop_selected(mask,-1);lab_unlock();return;}
    lab_motor_begin(mask);lab_leave_sync(mask);lab_motor_begin(mask);
    for(int i=0;i<4;++i)if(mask&(1U<<i)) {
        if(lab_motor_types[i]!=LARGE_MOTOR)lab_fail();
        if(!lab_raw_modes[i]) {
            lab_check(ev3_motor_config((motor_port_t)i,UNREGULATED_MOTOR));lab_raw_modes[i]=1;
        }
        lab_hold_mask&=~(1U<<i);lab_speed_targets[i]=power;lab_running_mask|=1U<<i;
        lab_check(ev3_motor_set_power((motor_port_t)i,power));
    }
    lab_unlock();
}
static void lab_speed_set(unsigned mask,float value) {
    int speed=lab_motor_percent(value);lab_lock();
    /* Updating one port through set_power cancels native STEP_SYNC. Never do it silently. */
    if(lab_sync_mask&mask)lab_fail();
    for(int i=0;i<4;++i)if((mask&(1U<<i))&&(lab_finite_mask&(1U<<i))&&speed&&speed*lab_speed_targets[i]<0)lab_fail();
    if(!speed){lab_stop_selected(mask,-1);lab_unlock();return;}
    for(int i=0;i<4;++i)if(mask&(1U<<i)) {
        lab_speed_targets[i]=speed;
        if((lab_running_mask&(1U<<i))&&!(lab_finite_mask&(1U<<i)))lab_check(lab_regulated_write((motor_port_t)i,speed));
    }
    lab_unlock();
}
static void lab_sync_begin(unsigned mask) {
    lab_lock();lab_leave_sync(mask);lab_motor_begin(mask);
    for(int i=0;i<4;++i)if(mask&(1U<<i)){lab_regulated_type(i);lab_hold_mask&=~(1U<<i);lab_sync_run_right[i]=-1;}
    for(int i=0;i<4;++i)if(mask&(1U<<i))lab_sync_partners[i]=mask;
    lab_sync_mask|=mask;lab_running_mask|=mask;lab_unlock();
}
/* Update an active continuous pair without braking between PID corrections. */
static void lab_continuous_steer(int left,int right,int power,int ratio) {
    unsigned mask=(1U<<left)|(1U<<right);lab_lock();
    if(!power){lab_stop(mask,true);lab_unlock();return;}
    lab_motor_begin(mask);
    bool continuous=lab_sync_run_right[left]==right
        &&(lab_running_mask&mask)==mask&&(lab_sync_mask&mask)==mask
        &&lab_sync_partners[left]==mask&&lab_sync_partners[right]==mask;
    bool unchanged=continuous&&lab_sync_run_power[left]==power&&lab_sync_run_turn[left]==ratio;
    if(!unchanged) {
        if(!continuous)lab_sync_begin(mask);
        lab_check(ev3_motor_steer((motor_port_t)left,(motor_port_t)right,power,ratio));
        lab_sync_run_right[left]=right;lab_sync_run_power[left]=power;lab_sync_run_turn[left]=ratio;
    }
    lab_unlock();
}
static void lab_hold_tick(void) {
    SYSTIM now;lab_check(get_tim(&now));
    if((double)(now-lab_hold_clock)<20000.0)return;
    lab_hold_clock=now;lab_lock();
    for(int i=0;i<4;++i)if(lab_hold_mask&(1U<<i)) {
        double error=(double)lab_hold_positions[i]-ev3_motor_get_counts((motor_port_t)i);
        int command=fabs(error)<=1?0:(int)fmax(-20.0,fmin(20.0,error));
        lab_check(ev3_motor_set_power((motor_port_t)i,command));
    }
    lab_unlock();
}
static void lab_encoder_reset(int port) {
    unsigned mask=1U<<port;lab_lock();
    if((lab_running_mask|lab_finite_mask)&mask)lab_motor_begin(mask);
    int32_t previous=ev3_motor_get_counts((motor_port_t)port);
    lab_check(ev3_motor_reset_counts((motor_port_t)port));
    if(lab_hold_mask&mask) {
        double shifted=(double)lab_hold_positions[port]-previous;
        if(shifted < -2147483000.0 || shifted > 2147483000.0)lab_fail();
        lab_hold_positions[port]=(int32_t)shifted;
    }
    lab_unlock();
}
static void lab_finite(unsigned mask,float speed,float amount,float seconds,int feedback) {
    int initial=lab_motor_percent(speed);lab_number(amount);lab_number(seconds);
    if(!initial||amount<0||amount>2147483000.0f||seconds<0||seconds>60||((amount>0)==(seconds>0)))lab_fail();
    double goal=amount>0?roundf(amount):0;
    if(amount>0&&goal<1)lab_fail();
    int sign=initial<0?-1:1,mode,last[4]={1000,1000,1000,1000};float up,down;
    int32_t origin[4]={0};double progress[4]={0},previous[4]={0},rates[4]={0},last_progress[4]={0};
    lab_lock();mode=lab_ramp_mode;up=lab_ramp_up;down=lab_ramp_down;
    lab_motor_begin(mask);lab_leave_sync(mask);lab_motor_begin(mask);
    for(int i=0;i<4;++i)if(mask&(1U<<i)) {
        lab_regulated_type(i);origin[i]=ev3_motor_get_counts((motor_port_t)i);
        lab_hold_mask&=~(1U<<i);lab_speed_targets[i]=initial;
    }
    lab_finite_mask|=mask;
    SYSTIM start;lab_check(get_tim(&start));lab_unlock();
    unsigned pending=mask;double previous_us=0;
    while(pending) {
        double elapsed=lab_elapsed(start),mean=0;int count=0;
        if(elapsed>180000000.0)lab_fail();
        lab_lock();
        if(!lab_motor_valid(pending)) {
            lab_complete(pending);lab_unlock();return;
        }
        for(int i=0;i<4;++i)if(pending&(1U<<i)) {
            progress[i]=((double)ev3_motor_get_counts((motor_port_t)i)-origin[i])*sign;
            mean+=progress[i];++count;
        }
        mean/=count;
        for(int i=0;i<4;++i)if(pending&(1U<<i)) {
            if((goal>0&&progress[i]>=goal)||(seconds>0&&elapsed>=seconds*1000000.0)) {
                lab_complete(1U<<i);pending&=~(1U<<i);continue;
            }
            if(progress[i]>previous[i])last_progress[i]=elapsed;
            if(goal>0&&elapsed-last_progress[i]>5000000.0)lab_fail();
            float factor=1;
            if(mode) {
                if(up>0) {float x=fminf(1,fmaxf(0,elapsed/(up*1000000.0)));factor=mode==2?x*x*(3-2*x):x;}
                if(down>0) {
                    double remaining=seconds>0?seconds*1000000.0-elapsed:rates[i]>0?(goal-progress[i])*1000000.0/rates[i]:down*1000000.0;
                    float x=fminf(1,fmaxf(0,remaining/(down*1000000.0)));factor=fminf(factor,mode==2?x*x*(3-2*x):x);
                }
            }
            int magnitude=(int)roundf(fabsf(lab_speed_targets[i])*factor);
            if(feedback&&count>1&&goal>0)magnitude+=(int)round(fmax(-15,fmin(15,(mean-progress[i])*.8)));
            if(goal>0)magnitude=(int)fmin(magnitude,fmax(1,(goal-progress[i])*2));
            if(magnitude<1)magnitude=1;if(magnitude>100)magnitude=100;
            int command=sign*magnitude;
            if(command!=last[i]){lab_check(lab_regulated_write((motor_port_t)i,command));last[i]=command;}
            if(elapsed-previous_us>=20000.0) {
                double rate=(progress[i]-previous[i])*1000000.0/(elapsed-previous_us);
                if(rate>0)rates[i]=rates[i]>0?.8*rates[i]+.2*rate:rate;
                previous[i]=progress[i];
            }
        }
        if(elapsed-previous_us>=20000.0)previous_us=elapsed;
        lab_unlock();if(pending)lab_poll();
    }
}
`;
