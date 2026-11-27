// Application sound, independent of Windows system-event sound settings.
export function createCompletionSound(createAudio = () => new Audio(new URL('./transfer-complete.wav', import.meta.url).href)) {
  let audio;
  return async function playCompletionSound() {
    audio ??= createAudio();
    audio.preload = 'auto';
    audio.volume = 0.8;
    audio.currentTime = 0;
    await audio.play();
  };
}
