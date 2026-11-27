// Preserve learner-authored names only when they cannot alter generated C syntax
// or hide the runtime, SDK APIs, standard functions, types, or macro names.
const reserved=new Set(`auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Alignas _Alignof _Atomic _Bool _Complex _Generic _Imaginary _Noreturn _Static_assert _Thread_local alignas alignof atomic bool true false nullptr typeof typeof_unqual constexpr static_assert thread_local asm
size_t ptrdiff_t wchar_t wint_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t intptr_t uintptr_t intmax_t uintmax_t float_t double_t jmp_buf va_list fpos_t div_t ldiv_t lldiv_t
main main_task abort exit abs labs llabs div ldiv lldiv malloc calloc realloc free getenv system rand srand atoi atol atoll atof strtod strtof strtol strtoul
printf fprintf sprintf snprintf vprintf vfprintf vsprintf vsnprintf puts putchar fopen fclose fread fwrite fgetc fgets fputc fputs fseek ftell feof ferror fflush remove rename perror
memcpy memmove memset memcmp strlen strcpy strncpy strcat strncat strcmp strncmp strchr strstr strtok strerror setjmp longjmp va_start va_arg va_end va_copy errno stdin stdout stderr
sin cos tan asin acos atan atan2 sinh cosh tanh exp exp2 log log2 log10 pow sqrt cbrt hypot ceil floor trunc round lround llround nearbyint rint remainder fmod fabs fmin fmax copysign isfinite isnan isinf signbit fpclassify
sinf cosf tanf asinf acosf atanf atan2f sinhf coshf tanhf expf exp2f logf log2f log10f powf sqrtf cbrtf hypotf ceilf floorf truncf roundf lroundf llroundf nearbyintf rintf remainderf fmodf fabsf fminf fmaxf copysignf
get_tid get_tim set_tim act_tsk ter_tsk ref_tsk ext_tsk tslp_tsk slp_tsk wup_tsk dly_tsk wai_sem twai_sem pol_sem sig_sem ref_sem loc_cpu unl_cpu chg_pri
motor_port_t motor_type_t sensor_port_t sensor_type_t button_t ledcolor_t colorid_t serial_port_t lcdcolor_t lcdfont_t bitmap_t image_t ir_remote_t ir_seek_t`.split(/\s+/));

// Names exported by C headers or TOPPERS services must not be redefined.
for(const name of `assert offsetof signal raise clock time difftime mktime localtime gmtime strftime qsort bsearch tolower toupper isalnum isalpha isdigit isspace isupper islower isprint ispunct isxdigit iscntrl isgraph
rot_rdq get_lod get_nth get_pri chg_spr dis_dsp ena_dsp sns_ctx sns_loc sns_dsp sns_dpn sns_ker
cre_tsk acre_tsk del_tsk can_act get_tst ras_ter dis_ter ena_ter sns_ter sus_tsk rsm_tsk frsm_tsk rel_wai can_wup
cre_sem acre_sem del_sem ini_sem cre_flg acre_flg del_flg set_flg clr_flg wai_flg pol_flg twai_flg ini_flg ref_flg
cre_dtq acre_dtq del_dtq snd_dtq psnd_dtq tsnd_dtq fsnd_dtq rcv_dtq prcv_dtq trcv_dtq ini_dtq ref_dtq
loc_mtx ploc_mtx tloc_mtx unl_mtx ini_mtx ref_mtx cre_mtx acre_mtx del_mtx
sta_cyc stp_cyc sta_alm stp_alm fch_hrt cal_svc syslog syslog_wri_log`.split(/\s+/))reserved.add(name);
for(const name of `clr_int dis_int ena_int ext_ker get_did iact_tsk iclr_int idis_int iena_int iext_ker ifch_hrt ifsnd_dtq iget_did iget_tid iloc_cpu imrot_rdq iprb_int ipsnd_dtq ipsnd_pdq iras_int irel_wai irot_rdq iset_flg isig_sem isns_ctx isns_dpn isns_dsp isns_ker isns_loc isns_ter ista_alm istp_alm iunl_cpu iwup_tsk ixsns_dpn mrot_rdq prb_int prb_mem psnd_pdq ras_int xsns_dpn
scanf fscanf sscanf vscanf vfscanf vsscanf ungetc freopen tmpfile tmpnam setbuf setvbuf fgetpos fsetpos rewind clearerr getc getchar gets putc
strcspn strpbrk strrchr strspn strcoll strxfrm asctime ctime serial_opn_por serial_cls_por serial_rea_dat serial_wri_dat serial_ctl_por serial_ref_por`.split(/\s+/))reserved.add(name);
for(const base of 'acosh asinh atanh erf erfc expm1 fdim fma frexp ilogb ldexp lgamma log1p logb modf nan nextafter nexttoward remquo scalbln scalbn tgamma'.split(' '))
  for(const suffix of ['', 'f', 'l'])reserved.add(base+suffix);

function safeName(name) {
  return typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(name)
    &&!reserved.has(name)&&!/^lab_|^ev3_|^TOPPERS_|^[A-Z][A-Z0-9_]*$/.test(name);
}

export function myBlockFunctionNames(names) {
  const used=new Set();
  return names.map((name,index)=>{
    const identifier=safeName(name)&&!used.has(name)?name:'lab_proc_'+index;
    used.add(identifier);return identifier;
  });
}

export function myBlockParameterNames(params,blocked=[]) {
  // A local parameter must not hide any My Block function called by this body.
  const used=new Set(blocked);
  return params.map((name,index)=>{
    const safe=safeName(name)&&!used.has(name);
    const identifier=safe?name:'lab_arg_'+index;
    used.add(identifier);return identifier;
  });
}
