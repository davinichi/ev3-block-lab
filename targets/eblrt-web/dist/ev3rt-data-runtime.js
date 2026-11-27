// Optional C runtime fragments. Only requested features introduce API dependencies.
export function dataRuntime(f) {
return (f.text?String.raw`
/* UTF-8文字列は値として受け渡す。共有変数の読み書きだけをロックする。 */
typedef struct {char data[121];} lab_text;
static lab_text lab_text_make(const char *s) {lab_text t={{0}};size_t n=strlen(s);if(n>120)lab_fail();memcpy(t.data,s,n+1);return t;}
static lab_text lab_text_load(lab_text *p) {lab_lock();lab_text t=*p;lab_unlock();return t;}
static void lab_text_store(lab_text *p,lab_text t) {lab_lock();*p=t;lab_unlock();}
static lab_text lab_text_join(lab_text a,lab_text b) {size_t n=strlen(a.data),m=strlen(b.data);if(n+m>120)lab_fail();memcpy(a.data+n,b.data,m+1);return a;}
static int lab_text_length(lab_text t) {int n=0;for(unsigned char *p=(unsigned char*)t.data;*p;++p)if((*p&192)!=128)++n;return n;}
static lab_text lab_text_letter(lab_text t,float v) {int nth=lab_integer(v,1,120),count=0;char *p=t.data;while(*p){if(((unsigned char)*p&192)!=128&&++count==nth)break;++p;}if(!*p)return lab_text_make("");char *end=p+1;while(*end&&((unsigned char)*end&192)==128)++end;*end=0;return lab_text_make(p);}
static lab_text lab_text_number(float v) {lab_text t;int n=snprintf(t.data,sizeof(t.data),"%.7g",(double)lab_number(v));if(n<0||n>120)lab_fail();return t;}
static float lab_text_parse(lab_text t) {
    /* EBLと同じ十進数の文法。空白・16進数・inf・nanは受け付けない。 */
    const char *p=t.data;if(*p=='+'||*p=='-')++p;int digits=0;while(*p>='0'&&*p<='9'){++p;++digits;}
    if(*p=='.'){++p;while(*p>='0'&&*p<='9'){++p;++digits;}}if(!digits)lab_fail();
    if(*p=='e'||*p=='E'){++p;if(*p=='+'||*p=='-')++p;digits=0;while(*p>='0'&&*p<='9'){++p;++digits;}if(!digits)lab_fail();}
    if(*p)lab_fail();return lab_number(strtof(t.data,NULL));
}
static float lab_text_compare(lab_text a,lab_text b,int equal) {return equal?strcmp(a.data,b.data)==0:strstr(a.data,b.data)!=NULL;}
`:'')+(f.list?String.raw`
typedef struct {int count;float items[1000];} lab_list;
static int lab_list_index(lab_list *p,float v) {return lab_integer(v,1,p->count)-1;}
static void lab_list_clear(lab_list *p) {lab_lock();p->count=0;lab_unlock();}
static void lab_list_add(lab_list *p,float v) {lab_lock();if(p->count>=1000)lab_fail();p->items[p->count++]=lab_number(v);lab_unlock();}
static void lab_list_set(lab_list *p,float i,float v) {lab_lock();p->items[lab_list_index(p,i)]=lab_number(v);lab_unlock();}
static void lab_list_delete(lab_list *p,float i) {lab_lock();int at=lab_list_index(p,i);memmove(p->items+at,p->items+at+1,(p->count-at-1)*sizeof(float));--p->count;lab_unlock();}
static float lab_list_read(lab_list *p,int op,float v) {
    lab_lock();float result=0;
    if(op==0)result=p->count;
    else if(op==1)result=p->items[lab_list_index(p,v)];
    else {if(op>=4&&!p->count)lab_fail();if(op==5||op==6)result=p->items[0];
        for(int i=0;i<p->count;++i){float item=p->items[i];if(op==2){if(item==v){result=1;break;}}else if(op==5)result=fminf(result,item);else if(op==6)result=fmaxf(result,item);else result=lab_number(result+item);}
        if(op==4)result=lab_number(result/p->count);
    }lab_unlock();return result;
}
`:'')+(f.pid?String.raw`
typedef struct {bool initialized;float previous,integral,cached;SYSTIM time;} lab_pid;
static void lab_pid_reset(lab_pid *p) {lab_lock();memset(p,0,sizeof(*p));lab_unlock();}
static float lab_pid_compute(lab_pid *p,float target,float measured,float kp,float ki,float kd) {
    lab_lock();SYSTIM now;lab_check(get_tim(&now));float error=lab_number(target-measured);uint64_t ms=(uint64_t)now/1000,old=(uint64_t)p->time/1000;
    if(p->initialized&&ms==old){float cached=p->cached;lab_unlock();return cached;}
    float result=lab_number(kp*error);
    if(p->initialized&&ms-old<=60000){float dt=(ms-old)/1000.0f;p->integral=lab_number(p->integral+lab_number(error*dt));float derivative=lab_number((error-p->previous)/dt);result=lab_number(lab_number(result+lab_number(ki*p->integral))+lab_number(kd*derivative));}
    else p->integral=0;
    p->initialized=true;p->previous=error;p->time=now;p->cached=result;lab_unlock();return result;
}
`:'')+(f.random?String.raw`
/* 整数乱数。棄却法で範囲への剰余による偏りを避ける（暗号用途ではない）。 */
static uint32_t lab_rng;
static float lab_random(float a,float b) {int low=lab_integer(a,-32767,32767),high=lab_integer(b,-32767,32767);if(low>high)lab_fail();lab_lock();if(!lab_rng){SYSTIM now;lab_check(get_tim(&now));lab_rng=(uint32_t)now^0x9e3779b9U;if(!lab_rng)lab_rng=1;}uint32_t n=(uint32_t)(high-low+1),limit=(0U-n)%n,r;do{lab_rng=lab_rng*1664525U+1013904223U;r=lab_rng;}while(r<limit);lab_unlock();return low+(int)(r%n);}
`:'')+(f.button?String.raw`
static float lab_button(int id) {switch(id){case 1:return ev3_button_is_pressed(UP_BUTTON);case 2:return ev3_button_is_pressed(ENTER_BUTTON);case 3:return ev3_button_is_pressed(DOWN_BUTTON);case 4:return ev3_button_is_pressed(RIGHT_BUTTON);case 5:return ev3_button_is_pressed(LEFT_BUTTON);case 7:return ev3_button_is_pressed(UP_BUTTON)||ev3_button_is_pressed(ENTER_BUTTON)||ev3_button_is_pressed(DOWN_BUTTON)||ev3_button_is_pressed(RIGHT_BUTTON)||ev3_button_is_pressed(LEFT_BUTTON);default:lab_fail();return 0;}}
`:'')+(f.ir?String.raw`
static float lab_ir(int port,int channel,int kind) {
    lab_lock();float result=0;
    if(kind==0){ir_remote_t r=ev3_infrared_sensor_get_remote((sensor_port_t)port);const unsigned masks[12]={0,1,2,4,8,5,9,6,10,16,3,12};bool found=false;for(int i=0;i<12;++i)if(r.channel[channel]==masks[i]){result=i;found=true;break;}if(!found)lab_fail();}
    else {ir_seek_t r=ev3_infrared_sensor_seek((sensor_port_t)port);int distance=r.distance[channel],heading=r.heading[channel];if(distance==-128)result=kind==2?100:0;else {if(distance<0||distance>100||heading< -25||heading>25)lab_fail();result=kind==1?1:kind==2?distance:heading;}}
    lab_unlock();return result;
}
`:'')+(f.display?String.raw`
/* 数値専用5×7ドット字形。通常/大の表示欄を毎回消してから描く。 */
static void lab_display_number(float value,int x,int y,int large,int decimals) {
    static const uint8_t glyph[12][5]={{62,81,73,69,62},{0,66,127,64,0},{66,97,81,73,70},{33,65,69,75,49},{24,20,18,127,16},{39,69,69,69,57},{60,74,73,73,48},{1,113,9,5,3},{54,73,73,73,54},{6,73,73,41,30},{8,8,8,8,8},{0,96,96,0,0}};
    char text[64];int n=snprintf(text,sizeof(text),"%.*f",decimals,(double)lab_number(value));if(n<0||n>10){strcpy(text,"##########");n=10;}
    int scale=large?2:1;lab_lock();lab_check(ev3_lcd_fill_rect(x,y,large?160:80,large?19:9,EV3_LCD_WHITE));
    for(int i=0;i<n;++i){int g=text[i]>='0'&&text[i]<='9'?text[i]-'0':text[i]=='-'?10:text[i]=='.'?11:-1;
        for(int col=0;col<5;++col)for(int row=0;row<7;++row)if(g<0?(row==1||row==5||col==1||col==3):(glyph[g][col]&(1U<<row)))lab_check(ev3_lcd_fill_rect(x+i*8*scale+col*scale,y+row*scale,scale,scale,EV3_LCD_BLACK));}
    lab_unlock();
}
`:'')+(f.log?String.raw`
/* CSVはSDカード直下の専用ファイル。毎行閉じ、終了時の開放漏れを避ける。 */
static char lab_log_path[100];static bool lab_log_active;static unsigned lab_log_rows;static SYSTIM lab_log_start;
static bool lab_csv_quote(FILE *fp,const char *s,bool protect) {bool bad=fputc('"',fp)==EOF;if(protect&&*s&&strchr("=+-@",*s))bad=fputc('\'',fp)==EOF||bad;for(;*s;++s){bad=fputc(*s,fp)==EOF||bad;if(*s=='"')bad=fputc('"',fp)==EOF||bad;}return fputc('"',fp)==EOF||bad;}
static void lab_log_begin(const char *path) {lab_lock();FILE *fp=fopen(path,"wb");if(!fp)lab_fail();bool bad=fputs("time_s,item,value\r\n",fp)<0;bad=fclose(fp)!=0||bad;if(bad)lab_fail();strcpy(lab_log_path,path);lab_check(get_tim(&lab_log_start));lab_log_rows=0;lab_log_active=true;lab_unlock();}
static void lab_log_end(void) {lab_lock();lab_log_active=false;lab_unlock();}
static void lab_log_value(const char *label,lab_text value,bool protect) {lab_lock();if(!lab_log_active||lab_log_rows>=5000)lab_fail();double seconds=lab_elapsed(lab_log_start)/1000000.0;FILE *fp=fopen(lab_log_path,"ab");if(!fp)lab_fail();bool bad=fprintf(fp,"%.3f,",seconds)<0;bad=lab_csv_quote(fp,label,true)||bad;bad=fputc(',',fp)==EOF||bad;bad=lab_csv_quote(fp,value.data,protect)||bad;bad=fputs("\r\n",fp)<0||bad;bad=fclose(fp)!=0||bad;if(bad)lab_fail();++lab_log_rows;lab_unlock();}
`:'')+(f.led?String.raw`
/* 公開APIには点滅がないため、監督タスクが約20msごとに点灯色を切り替える。 */
static int lab_led_color,lab_led_mode;static SYSTIM lab_led_start,lab_led_tick_time;
static void lab_led(int color,int mode) {lab_lock();lab_led_color=color;lab_led_mode=mode;lab_check(get_tim(&lab_led_start));lab_check(ev3_led_set_color(color));lab_unlock();}
static void lab_aux_tick(void) {lab_lock();SYSTIM now;lab_check(get_tim(&now));if(lab_led_mode&&now-lab_led_tick_time>=20000){lab_led_tick_time=now;uint64_t elapsed=now-lab_led_start;bool on=lab_led_mode==1?(elapsed%500000<250000):(elapsed%1000000<600000);lab_check(ev3_led_set_color(on?lab_led_color:LED_OFF));}lab_unlock();}
`:'');
}
