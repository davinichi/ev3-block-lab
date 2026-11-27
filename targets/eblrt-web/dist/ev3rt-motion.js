// EV3RT's steer API issues one native STEP_SYNC command for the selected pair.
// Finite moves monitor the outer encoder; the driver maintains the wheel ratio.
export const MOTION_RUNTIME=String.raw`
static int lab_left=-1,lab_right=-1,lab_ramp_mode=0;
static float lab_diameter=0,lab_track=0,lab_ramp_up=0,lab_ramp_down=0;
static unsigned lab_movement_mask(void) {
    if (lab_left<0 || lab_right<0 || lab_left==lab_right) lab_fail();
    return (1U<<lab_left)|(1U<<lab_right);
}
static void lab_pair_setup(int left,int right) {
    if (left<0 || left>3 || right<0 || right>3 || left==right) lab_fail();
    if (lab_left>=0 && lab_right>=0) lab_stop((1U<<lab_left)|(1U<<lab_right),true);
    lab_left=left; lab_right=right;
}
static void lab_ramp(int mode,float up,float down) {
    lab_number(up);lab_number(down);
    if (mode<0 || mode>2 || up<0 || up>10 || down<0 || down>10) lab_fail();
    lab_ramp_mode=mode;lab_ramp_up=up;lab_ramp_down=down;
}
static float lab_shape(float f) {
    f=fminf(1.0f,fmaxf(0.0f,f));
    return lab_ramp_mode==2 ? f*f*(3.0f-2.0f*f) : f;
}
static void lab_motion(int left,int right,float speed,float turn,float angle,float seconds,int finite) {
    int power=lab_motor_percent(speed),ratio=lab_integer(turn,-100,100);
    lab_number(angle);lab_number(seconds);
    if (left<0 || right<0 || left>3 || right>3 || left==right) lab_fail();
    unsigned mask=(1U<<left)|(1U<<right);
    if (!finite) {
        lab_continuous_steer(left,right,power,ratio);
        return;
    }
    if (!power || angle<0 || angle>2147483000.0f || seconds<0 || seconds>60 || ((angle>0)==(seconds>0))) lab_fail();
    double target=angle>0 ? roundf(angle) : 0;
    if (angle>0 && target<1) lab_fail();
    int outer=ratio<0 ? right : left,sign=power<0?-1:1;
    int32_t origin=ev3_motor_get_counts((motor_port_t)outer);
    SYSTIM start;lab_check(get_tim(&start));
    double previous_us=0,previous_progress=0,rate=0,last_progress_us=0;
    int last_power=1000;
    for (;;) {
        double elapsed=lab_elapsed(start),progress=((double)ev3_motor_get_counts((motor_port_t)outer)-origin)*sign;
        if ((angle>0 && progress>=target) || (seconds>0 && elapsed>=seconds*1000000.0)) break;
        if (elapsed>180000000.0) lab_fail();
        if (progress>previous_progress) last_progress_us=elapsed;
        if (angle>0 && elapsed-last_progress_us>5000000.0) lab_fail();
        float factor=1.0f;
        if (lab_ramp_mode) {
            if (lab_ramp_up>0) factor=lab_shape((float)(elapsed/(lab_ramp_up*1000000.0)));
            if (lab_ramp_down>0) {
                if (seconds>0) factor=fminf(factor,lab_shape((float)((seconds*1000000.0-elapsed)/(lab_ramp_down*1000000.0))));
                else if (rate>0) {
                    double braking=rate*lab_ramp_down*0.5;
                    if (braking>0) factor=fminf(factor,lab_shape(sqrtf((float)(fmax(0,target-progress)/braking))));
                }
            }
        }
        int magnitude=(int)roundf(abs(power)*factor);
        if (magnitude<1) magnitude=1;
        int command=sign*magnitude;
        if (command!=last_power) {
            lab_check(ev3_motor_steer((motor_port_t)left,(motor_port_t)right,command,ratio));
            last_power=command;
        }
        if (elapsed-previous_us>=20000.0) {
            double measured=(progress-previous_progress)*1000000.0/(elapsed-previous_us);
            if (measured>0) {
                double estimate=fmin(10000.0,measured*(double)abs(power)/magnitude);
                rate=rate>0?rate*0.8+estimate*0.2:estimate;
            }
            previous_progress=progress;previous_us=elapsed;
        }
        lab_poll();
    }
    lab_stop(mask,true);
}
static void lab_steering(float turn,float speed,float angle,float seconds,int finite) {
    lab_movement_mask();lab_motion(lab_left,lab_right,speed,turn,angle,seconds,finite);
}
static void lab_tank(float left,float right,float angle,float seconds,int finite) {
    int l=lab_motor_percent(left),r=lab_motor_percent(right);
    if (!l && !r) { if (finite) lab_fail();lab_stop(lab_movement_mask(),true);return; }
    float power,turn;
    if (abs(l)>=abs(r)) {power=l;turn=50.0f*(1.0f-(float)r/l);}
    else {power=r;turn=-50.0f*(1.0f-(float)l/r);}
    lab_steering(roundf(turn),power,angle,seconds,finite);
}
static float lab_geometry(int kind,float value) {
    lab_number(value);
    if (lab_diameter<10 || lab_diameter>200 || value<=0) lab_fail();
    if (kind==0) return roundf(value*3600.0f/(3.14159265358979323846f*lab_diameter));
    if (lab_track<10 || lab_track>1000) lab_fail();
    int degrees=lab_integer(value,1,3600);
    return roundf(degrees*lab_track/lab_diameter*(kind==2?2.0f:1.0f));
}
`;
