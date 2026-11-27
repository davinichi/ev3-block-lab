// Shortest decimal that round-trips to the same IEEE-754 binary32 value.
// Keep everyday classroom inputs readable; retain scientific notation at extremes.
export function cFloatLiteral(value) {
  if(typeof value!=='number'||!Number.isFinite(value))throw Error('EV3-RT: 有限の数値を指定してください。');
  const rounded=Math.fround(value);
  if(!Number.isFinite(rounded))throw Error('EV3-RT: float型で表せる範囲の数値を指定してください。');
  if(Object.is(rounded,-0))return '-0.0f';
  if(rounded===0)return '0.0f';
  let decimal;
  for(let precision=1;precision<=9;precision++) {
    decimal=rounded.toPrecision(precision);
    if(Object.is(Math.fround(Number(decimal)),rounded))break;
  }
  const magnitude=Math.abs(rounded);
  if(magnitude>=1e-6&&magnitude<1e9)decimal=String(Number(decimal));
  else {
    const [mantissa,exponent]=Number(decimal).toExponential().split('e');
    decimal=(mantissa.includes('.')?mantissa:mantissa+'.0')+'e'+exponent;
  }
  if(!/[.e]/i.test(decimal))decimal+='.0';
  return decimal+'f';
}
