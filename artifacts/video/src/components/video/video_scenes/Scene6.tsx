import { motion } from 'framer-motion';

export const Scene6 = () => {
  return (
    <motion.div
      className="absolute inset-0 w-full h-full flex flex-col items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(20px)', scale: 1.2 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      
      {/* Background is handled globally (turns dark) */}

      <div className="relative z-20 text-center flex flex-col items-center">
        <motion.div
          className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mb-6 shadow-2xl shadow-primary/50"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          exit={{ scale: 0 }}
          transition={{ duration: 1, type: "spring", bounce: 0.5, delay: 0.2 }}
        >
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </motion.div>

        <motion.h1
          className="text-[6vw] font-display font-bold text-white leading-none tracking-tighter"
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
        >
          VoxAgent
        </motion.h1>

        <motion.p
          className="text-[1.8vw] text-slate-300 mt-6 max-w-[50vw] font-light"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1, delay: 0.8 }}
        >
          Every call understood. <br/>
          Every persona crafted. <br/>
          Every language served.
        </motion.p>
      </div>

    </motion.div>
  );
};
