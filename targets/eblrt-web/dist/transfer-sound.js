// Arm audio during the transfer-button gesture, then notify only after success.
export function createTransferSound(AudioContextClass=globalThis.AudioContext??globalThis.webkitAudioContext){
  let context=null,ready=Promise.resolve(false);
  function arm(){
    try{
      if(!AudioContextClass)return false;
      if(!context||context.state==='closed')context=new AudioContextClass();
      ready=Promise.resolve(context.state==='running'?undefined:context.resume()).then(()=>context.state==='running',()=>false);
      return true;
    }catch{ready=Promise.resolve(false);return false;}
  }
  async function play(){
    try{
      if(!await ready||context?.state!=='running')return false;
      const start=context.currentTime+.02;
      for(const [offset,frequency] of [[0,660],[.18,880]]){
        const oscillator=context.createOscillator(),gain=context.createGain(),time=start+offset;
        oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,time);
        gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(.1,time+.01);gain.gain.linearRampToValueAtTime(0,time+.14);
        oscillator.connect(gain);gain.connect(context.destination);
        oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
        oscillator.start(time);oscillator.stop(time+.15);
      }
      return true;
    }catch{return false;}
  }
  return {arm,play};
}
