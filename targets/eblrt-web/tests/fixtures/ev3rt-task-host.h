#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
typedef int ER;
typedef int ID;
typedef int motor_port_t;
typedef uint64_t SYSTIM;
#define E_OK 0
#define E_TMOUT (-50)
#define E_OBJ (-41)
#define LAB_SHARED_SEM 1
#define BACK_BUTTON 6
#define UP_BUTTON 1
#define ENTER_BUTTON 2
#define DOWN_BUTTON 3
#define RIGHT_BUTTON 4
#define LEFT_BUTTON 5
typedef int sensor_port_t;
#define EV3_LCD_WHITE 0
#define EV3_LCD_BLACK 1
#define LARGE_MOTOR 1
#define MEDIUM_MOTOR 2
#define UNREGULATED_MOTOR 3
#define TOUCH_SENSOR 1
#define COLOR_SENSOR 2
#define ULTRASONIC_SENSOR 3
#define GYRO_SENSOR 4
#define INFRARED_SENSOR 5
#define LED_OFF 0
#define LED_GREEN 1
#define LED_RED 2
#define LED_ORANGE 3
#define MAIN_TASK 1
#define TMIN_APP_TPRI 1
enum {EV3_PORT_A,EV3_PORT_B,EV3_PORT_C,EV3_PORT_D};
enum {EV3_PORT_1=1,EV3_PORT_2,EV3_PORT_3,EV3_PORT_4};
enum {LAB_TASK_0=2,LAB_TASK_1,LAB_TASK_2,LAB_TASK_3,LAB_TASK_4,LAB_TASK_5,LAB_TASK_6,LAB_TASK_7,LAB_TASK_8,LAB_TASK_9,LAB_TASK_10,LAB_TASK_11,LAB_TASK_12,LAB_TASK_13,LAB_TASK_14,LAB_TASK_15};
static __thread ID mock_id=MAIN_TASK;
static pthread_mutex_t mock_mutex=PTHREAD_MUTEX_INITIALIZER;
static pthread_t mock_threads[18];
static bool mock_created[18];
static int mock_power[4];
static int mock_modes[4],mock_commands[4],mock_first[4],mock_brakes[4],mock_coasts[4];
static double mock_counts[4],mock_rates[4];
static uint64_t mock_physics_at,mock_disturb_at;
static void mock_physics(void);
static unsigned mock_tones;
static uint64_t mock_back_at;
static uint64_t mock_now(void) {struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (uint64_t)t.tv_sec*1000000+t.tv_nsec/1000;}
static void mock_physics(void) {
 uint64_t now=mock_now();if(mock_physics_at)for(int i=0;i<4;++i)mock_counts[i]+=mock_power[i]*mock_rates[i]*(now-mock_physics_at)/1000000.0;
 mock_physics_at=now;if(mock_disturb_at&&now>=mock_disturb_at){mock_counts[1]+=10;mock_disturb_at=0;}
}
static ER get_tid(ID *id) {*id=mock_id;return E_OK;}
static ER get_tim(SYSTIM *t) {*t=mock_now();return E_OK;}
static ER wai_sem(ID id) {(void)id;pthread_mutex_lock(&mock_mutex);return E_OK;}
static ER sig_sem(ID id) {(void)id;pthread_mutex_unlock(&mock_mutex);return E_OK;}
static ER tslp_tsk(unsigned us) {usleep(us);return E_TMOUT;}
static ER ext_tsk(void) {if(mock_id!=MAIN_TASK)pthread_exit(NULL);return E_OK;}
static ER act_tsk(ID id);
/* Host joins use the generated stop checkpoints. HRP3 itself terminates via ter_tsk.
 * Do not asynchronously cancel pthread_exit while it owns Cygwin runtime locks. */
static ER ter_tsk(ID id) {if(mock_created[id]){pthread_join(mock_threads[id],NULL);mock_created[id]=false;}return E_OK;}
static bool ev3_button_is_pressed(int b) {return b==BACK_BUTTON?(mock_back_at && mock_now()>=mock_back_at):b==UP_BUTTON;}
static ER ev3_motor_config(int p,int t) {mock_physics();mock_modes[p]=t;mock_power[p]=0;return E_OK;}
static ER ev3_sensor_config(int p,int t) {(void)p;(void)t;return E_OK;}
static ER ev3_motor_stop(int p,bool b) {mock_physics();mock_power[p]=0;if(b)++mock_brakes[p];else ++mock_coasts[p];return E_OK;}
static ER ev3_motor_set_power(int p,int power) {mock_physics();if(!mock_commands[p])mock_first[p]=power;++mock_commands[p];mock_power[p]=power;return E_OK;}
static int ev3_motor_get_power(int p) {return mock_power[p];}
static ER ev3_motor_rotate(int p,int amount,int power,bool wait) {(void)p;(void)amount;(void)power;(void)wait;return E_OK;}
static unsigned mock_steer_calls;
static ER ev3_motor_steer(int l,int r,int p,int ratio) {(void)ratio;++mock_steer_calls;mock_power[l]=mock_power[r]=p;return E_OK;}
static int ev3_motor_get_counts(int p) {mock_physics();return (int)mock_counts[p];}
static ER ev3_motor_reset_counts(int p) {mock_physics();mock_counts[p]=0;return E_OK;}
static int ev3_gyro_sensor_get_angle(int p) {(void)p;return 0;}
static int ev3_gyro_sensor_get_rate(int p) {(void)p;return 0;}
static int ev3_touch_sensor_is_pressed(int p) {(void)p;return 0;}
static int ev3_color_sensor_get_color(int p) {(void)p;return 0;}
static int ev3_color_sensor_get_reflect(int p) {(void)p;return 0;}
static int ev3_ultrasonic_sensor_get_distance(int p) {(void)p;return 0;}
static int ev3_infrared_sensor_get_distance(int p) {(void)p;return 0;}
static int ev3_battery_voltage_mV(void) {return 8000;}
static int ev3_battery_current_mA(void) {return 100;}
static ER ev3_speaker_set_volume(int v) {(void)v;return E_OK;}
static ER ev3_speaker_play_tone(int f,int ms) {(void)f;(void)ms;++mock_tones;return E_OK;}
static ER ev3_speaker_stop(void) {return E_OK;}
static unsigned mock_led_changes;static int mock_led_color;
static ER ev3_led_set_color(int c) {if(c!=mock_led_color)++mock_led_changes;mock_led_color=c;return E_OK;}
static ER ev3_lcd_fill_rect(int x,int y,int w,int h,int c) {(void)x;(void)y;(void)w;(void)h;(void)c;return E_OK;}

typedef struct {uint8_t channel[4];} ir_remote_t;
typedef struct {int8_t heading[4],distance[4];} ir_seek_t;
static ir_remote_t ev3_infrared_sensor_get_remote(sensor_port_t p) {(void)p;return (ir_remote_t){{0,9,16,12}};}
static ir_seek_t ev3_infrared_sensor_seek(sensor_port_t p) {(void)p;return (ir_seek_t){{-25,0,12,25},{30,-128,50,100}};}
/* Host-only virtual SD root: tests never write to the real filesystem root. */
static FILE *mock_sd_fopen(const char *name,const char *mode) {return fopen(name[0]=='/'?name+1:name,mode);}
#define fopen mock_sd_fopen
