// Notify only after the awaited transfer has positively completed.
// A sound failure must not change the outcome of an already completed transfer.
export async function finishTransfer(operation, kind, beep) {
  const result = await operation();
  const success = kind === 'sd'
    ? result?.canceled !== true && result?.readbackVerified === true
    : kind === 'pan' && result?.received === true;
  if (success) {
    try { await beep(); } catch { /* Keep the successful transfer result. */ }
  }
  return result;
}
