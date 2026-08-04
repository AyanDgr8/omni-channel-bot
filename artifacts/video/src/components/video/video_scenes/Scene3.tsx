import { motion } from 'framer-motion';

export const Scene3 = () => {
  return (
    <motion.div
      className="absolute inset-0 w-full h-full flex flex-col items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      
      <div className="absolute top-[12vh] text-center z-20">
        <motion.h2
          className="text-[3.5vw] font-display font-bold leading-tight tracking-tight mb-2"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          Intelligent Routing &amp; Detection
        </motion.h2>
        <motion.p
          className="text-[1.5vw] text-text-muted"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          Time-of-day greeting · Queue logic · AMD Detection
        </motion.p>
      </div>

      {/* Diagram container */}
      <div className="relative mt-[10vh] w-[80vw] h-[50vh] flex items-center justify-center z-10">
        
        {/* Central Hub */}
        <motion.div
          className="absolute w-[14vw] h-[14vw] rounded-3xl bg-white shadow-xl border border-slate-200 flex flex-col items-center justify-center z-20"
          initial={{ scale: 0, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          exit={{ scale: 0 }}
          transition={{ duration: 0.8, type: "spring", stiffness: 200, damping: 20, delay: 0.4 }}
        >
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="font-display font-bold text-[1.5vw]">Call Engine</span>
        </motion.div>

        {/* Left Branch - Inbound */}
        <motion.div
          className="absolute left-[15vw] w-[18vw] p-5 rounded-2xl glass-panel text-center z-10"
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 50 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.8 }}
        >
          <div className="font-bold text-primary mb-2 uppercase tracking-wide text-[1vw]">Inbound</div>
          <div className="text-[1vw] text-slate-600 font-medium">Dynamic Greeting</div>
          <div className="text-[0.9vw] text-slate-400 mt-1">"Good morning, how can I help?"</div>
        </motion.div>

        {/* Right Branch - Outbound */}
        <motion.div
          className="absolute right-[15vw] w-[18vw] p-5 rounded-2xl glass-panel text-center z-10"
          initial={{ opacity: 0, x: -100 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -50 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 1.1 }}
        >
          <div className="font-bold text-secondary mb-2 uppercase tracking-wide text-[1vw]">Outbound</div>
          <div className="text-[1vw] text-slate-600 font-medium">AMD Classification</div>
          <div className="flex justify-center gap-2 mt-2">
            <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-[0.7vw] font-bold">HUMAN</span>
            <span className="px-2 py-1 rounded bg-slate-100 text-slate-600 text-[0.7vw] font-bold">VOICEMAIL</span>
          </div>
        </motion.div>

        {/* Connecting Lines */}
        <svg className="absolute inset-0 w-full h-full z-0" pointerEvents="none">
          <motion.path
            d="M 50% 50% L 25% 50%"
            stroke="url(#lineGrad1)" strokeWidth="4" fill="none" strokeDasharray="6 6"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, delay: 0.8 }}
          />
          <motion.path
            d="M 50% 50% L 75% 50%"
            stroke="url(#lineGrad2)" strokeWidth="4" fill="none" strokeDasharray="6 6"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, delay: 1.1 }}
          />
          <defs>
            <linearGradient id="lineGrad1" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0%" stopColor="var(--color-primary)" />
              <stop offset="100%" stopColor="var(--color-primary-light)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lineGrad2" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--color-secondary)" />
              <stop offset="100%" stopColor="var(--color-secondary-light)" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

      </div>

    </motion.div>
  );
};
