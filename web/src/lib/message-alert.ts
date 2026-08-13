type AudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let alertAudioContext: AudioContext | undefined;

function messageAlertAudioContext() {
  if (typeof window === "undefined") return;
  const AudioContextConstructor =
    window.AudioContext ??
    (window as AudioContextWindow).webkitAudioContext;
  if (!AudioContextConstructor) return;
  alertAudioContext ??= new AudioContextConstructor();
  return alertAudioContext;
}

export function prepareMessageAlertTone() {
  const context = messageAlertAudioContext();
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

function playMessageAlertTone() {
  const context = messageAlertAudioContext();
  if (!context || context.state !== "running") return;

  const start = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(740, start);
  oscillator.frequency.setValueAtTime(988, start + 0.1);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.16, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.24);
}

export function announceIncomingMessage({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  playMessageAlertTone();
  if (
    typeof window === "undefined" ||
    window.Notification?.permission !== "granted"
  )
    return;
  new window.Notification(title, { body, icon: "/linkit.svg" });
}
