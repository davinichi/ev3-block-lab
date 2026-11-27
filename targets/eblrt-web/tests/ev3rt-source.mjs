// Runtime assertions inspect the translation unit; compiler tests keep the real files separate.
export function expandedSource(built) {
  const prefix=built.name+'/';
  return [built.files[prefix+'ebl_rt_runtime.h'],built.files[prefix+'ebl_rt_runtime.c'],built.files[prefix+'ebl_myblocks.h'],built.files[prefix+'ebl_myblocks.c'],built.files[prefix+'app.c']].join('\n');
}
