import { useState, useRef, useCallback, useEffect } from "react";

/** The API is prefixed everywhere except Firefox, which does not have it. */
const getRecognition = () => window.SpeechRecognition || window.webkitSpeechRecognition;

export const isSpeechRecognitionSupported = () => Boolean(getRecognition());

/**
 * Push-to-talk dictation.
 *
 * Ten seconds is a hard ceiling on a single utterance. Without it a session
 * that never fires `onend` — which happens when the tab loses focus mid-listen
 * — leaves the mic indicator on forever with no way to clear it.
 */
export function useSpeechRecognition({ onTranscript, onUnsupported }) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);

  const stop = useCallback(() => {
    clearTimeout(timerRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    const Recognition = getRecognition();
    if (!Recognition) {
      onUnsupported?.();
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      timerRef.current = setTimeout(() => {
        try {
          recognition.stop();
        } catch {
          /* already stopped */
        }
      }, 10_000);
    };

    recognition.onend = () => {
      setIsListening(false);
      clearTimeout(timerRef.current);
      recognitionRef.current = null;
    };

    recognition.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
      if (text.trim()) onTranscript?.(`${text} `);
    };

    recognition.onerror = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
  }, [onTranscript, onUnsupported]);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  // A live recognition session outlives the component otherwise, and keeps the
  // browser's microphone indicator lit after the UI is gone.
  useEffect(() => stop, [stop]);

  return { isListening, start, stop, toggle };
}

export default useSpeechRecognition;
