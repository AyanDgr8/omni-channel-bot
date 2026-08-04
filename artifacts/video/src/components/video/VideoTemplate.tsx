import { useEffect, useRef } from 'react';
import { useVideoPlayer } from '@/lib/video';
import { AnimatePresence, motion } from 'framer-motion';

import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';

export const SCENE_DURATIONS: Record<string, number> = {
  intro: 4000,
  persona: 4500,
  routing: 4500,
  intelligence: 4000,
  fleet: 4000,
  outro: 3500,
};

const SCENE_KEYS = Object.keys(SCENE_DURATIONS);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCENE_COMPONENTS: Record<string, React.ComponentType<any>> = {
  intro: Scene1,
  persona: Scene2,
  routing: Scene3,
  intelligence: Scene4,
  fleet: Scene5,
  outro: Scene6,
};

const SCENE_START_SEC: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let cumulativeMs = 0;
  for (const [key, ms] of Object.entries(SCENE_DURATIONS)) {
    out[key] = cumulativeMs / 1000;
    cumulativeMs += ms;
  }
  return out;
})();

const AUDIO_SEEK_EPSILON_SEC = 0.18;

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const sceneIndex = SCENE_KEYS.indexOf(baseSceneKey);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    const targetTime = SCENE_START_SEC[baseSceneKey] ?? 0;
    if (Math.abs(audio.currentTime - targetTime) > AUDIO_SEEK_EPSILON_SEC) {
      audio.currentTime = targetTime;
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, baseSceneKey, muted]);

  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    <>
      <div className="w-full h-screen overflow-hidden relative bg-bg-base font-sans text-text-main">

        {/* PERSISTENT BACKGROUND LAYERS */}

        {/* 1. Global Gradient that shifts per scene */}
        <motion.div
          className="absolute inset-0 opacity-40 mix-blend-multiply"
          animate={{
            background:
              sceneIndex === 0
                ? 'linear-gradient(120deg, #e0e7ff 0%, #cffafe 100%)'
                : sceneIndex === 1
                ? 'linear-gradient(120deg, #e0e7ff 0%, #f1f5f9 100%)'
                : sceneIndex === 2
                ? 'linear-gradient(120deg, #cffafe 0%, #e0e7ff 100%)'
                : sceneIndex === 5
                ? 'linear-gradient(120deg, #0F172A 0%, #1e1b4b 100%)'
                : 'linear-gradient(120deg, #f8fafc 0%, #e2e8f0 100%)',
          }}
          transition={{ duration: 1.5, ease: 'easeInOut' }}
        />

        {/* 2. Abstract Network Background */}
        <motion.div
          className="absolute inset-0 z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: sceneIndex >= 2 && sceneIndex <= 4 ? 0.3 : 0 }}
          transition={{ duration: 1 }}
        >
          <video
            src={`${import.meta.env.BASE_URL}attached_assets/video_bg_network.mp4`}
            className="w-full h-full object-cover mix-blend-darken"
            autoPlay
            muted
            loop
            playsInline
          />
        </motion.div>

        {/* 3. Audio Waves Background (Intro) */}
        <motion.div
          className="absolute inset-0 z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: sceneIndex === 0 ? 0.8 : 0 }}
          transition={{ duration: 1 }}
        >
          <video
            src={`${import.meta.env.BASE_URL}attached_assets/video_bg_waves.mp4`}
            className="w-full h-full object-cover mix-blend-darken"
            autoPlay
            muted
            loop
            playsInline
          />
        </motion.div>

        {/* Persistent large blur orbs */}
        <motion.div
          className="absolute w-[60vw] h-[60vw] rounded-full blur-[100px] z-0 pointer-events-none"
          animate={{
            x: sceneIndex % 2 === 0 ? '-10vw' : '40vw',
            y: sceneIndex % 2 === 0 ? '-20vh' : '50vh',
            backgroundColor: sceneIndex === 5 ? '#312e81' : '#e0e7ff',
            scale: sceneIndex === 5 ? 1.5 : 1,
          }}
          transition={{ duration: 3, ease: 'easeInOut' }}
        />

        <motion.div
          className="absolute w-[40vw] h-[40vw] rounded-full blur-[80px] z-0 pointer-events-none"
          animate={{
            x: sceneIndex % 2 === 0 ? '60vw' : '10vw',
            y: sceneIndex % 2 === 0 ? '60vh' : '-10vh',
            backgroundColor: sceneIndex === 5 ? '#1e1b4b' : '#cffafe',
            scale: sceneIndex === 5 ? 2 : 1,
          }}
          transition={{ duration: 4, ease: 'easeInOut' }}
        />

        {/* Persistent Logo (top-left, hidden on outro) */}
        <motion.div
          className="absolute top-[4vh] left-[4vw] z-50 flex items-center gap-3"
          animate={{
            opacity: sceneIndex === 5 ? 0 : 1,
            y: sceneIndex === 5 ? -20 : 0,
          }}
          transition={{ duration: 0.5 }}
        >
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          </div>
          <span
            className="font-display font-bold text-xl tracking-tight"
            style={{ color: sceneIndex === 5 ? '#fff' : 'var(--color-text-main)' }}
          >
            VoxAgent
          </span>
        </motion.div>

        {/* SCENE CONTENT */}
        <div className="relative z-10 w-full h-full">
          <AnimatePresence mode="sync">
            {/* key must be currentSceneKey (not baseSceneKey) so _r1/_r2 variants remount */}
            {SceneComponent && <SceneComponent key={currentSceneKey} />}
          </AnimatePresence>
        </div>
      </div>

      {/* Background music — muted in iframe preview by default */}
      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`}
        preload="auto"
        autoPlay
        muted={muted}
      />
    </>
  );
}
