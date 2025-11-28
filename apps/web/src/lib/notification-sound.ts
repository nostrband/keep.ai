class NotificationSound {
  private audio: HTMLAudioElement | null = null;
  private isEnabled: boolean = true;
  private volume: number = 0.5;

  constructor() {
    if (typeof window !== "undefined") {
      this.initializeAudio();
    }
  }

  private initializeAudio() {
    try {
      // Create audio element with a simple notification sound using Web Audio API
      this.audio = new Audio();
      this.audio.volume = this.volume;
      this.audio.preload = "auto";

      // Use a data URL for a simple notification beep sound
      // This creates a short, pleasant notification tone
      this.audio.src = this.generateNotificationTone();
    } catch (error) {
      console.warn("Failed to initialize notification audio:", error);
    }
  }

  private generateNotificationTone(): string {
    // Generate a simple notification tone using Web Audio API
    try {
      const audioContext = new (window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext)();
      const sampleRate = audioContext.sampleRate;
      const duration = 0.3; // 300ms
      const length = sampleRate * duration;
      const buffer = audioContext.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      // Create a pleasant notification sound (two-tone beep)
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const freq1 = 800; // First tone frequency
        const freq2 = 1000; // Second tone frequency

        // Create envelope for smooth attack and decay
        const envelope =
          Math.exp(-t * 3) * (t < 0.15 ? 1 : Math.exp(-(t - 0.15) * 8));

        // Mix two frequencies for a pleasant notification sound
        const tone =
          t < 0.15
            ? Math.sin(2 * Math.PI * freq1 * t)
            : Math.sin(2 * Math.PI * freq2 * t);

        data[i] = tone * envelope * 0.3; // Keep volume moderate
      }

      // Convert buffer to WAV data URL
      return this.bufferToWav(buffer);
    } catch (error) {
      console.warn(
        "Failed to generate notification tone, using fallback:",
        error
      );
      // Fallback: return a data URL for a simple beep
      return "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT";
    }
  }

  private bufferToWav(buffer: AudioBuffer): string {
    const length = buffer.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    const data = buffer.getChannelData(0);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * 2, true);

    // Convert float samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, data[i]));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }

    const blob = new Blob([arrayBuffer], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  }

  public async play(): Promise<void> {
    if (!this.isEnabled || !this.audio) {
      return;
    }

    try {
      // Reset audio to beginning
      this.audio.currentTime = 0;

      // Play the notification sound
      await this.audio.play();
    } catch (error) {
      // Handle autoplay restrictions gracefully
      if (error instanceof Error && error.name === "NotAllowedError") {
        console.warn(
          "Notification sound blocked by browser autoplay policy. User interaction required."
        );
      } else {
        console.warn("Failed to play notification sound:", error);
      }
    }
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio) {
      this.audio.volume = this.volume;
    }
  }

  public isAudioEnabled(): boolean {
    return this.isEnabled;
  }

  public getVolume(): number {
    return this.volume;
  }
}

// Create a singleton instance
export let notificationSound: NotificationSound | undefined;

async function enableSoundsOnce() {
  if (!notificationSound) {
    notificationSound = new NotificationSound();
    // await audioCtx.resume().catch(() => {});
  }
}
if ("document" in globalThis)
  globalThis.document.addEventListener("click", enableSoundsOnce, {
    once: true,
  });

// Export the class for potential custom instances
export { NotificationSound };
