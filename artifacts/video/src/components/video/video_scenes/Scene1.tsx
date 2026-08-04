import { motion } from 'framer-motion';

export const Scene1 = () => {
  return (
    <motion.div
      className="absolute inset-0 w-full h-full flex flex-col items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      
      {/* Decorative center piece */}
      <motion.div
        className="absolute z-0 w-[40vw] h-[40vw] max-w-[500px] max-h-[500px] border border-primary/20 rounded-full"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 1.5, opacity: 0 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
      />
      <motion.div
        className="absolute z-0 w-[55vw] h-[55vw] max-w-[700px] max-h-[700px] border border-secondary/10 rounded-full"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 1.2, opacity: 0 }}
        transition={{ duration: 1.5, ease: "easeOut", delay: 0.2 }}
      />

      <div className="relative z-10 text-center flex flex-col items-center justify-center">
        <motion.div
          className="overflow-hidden mb-6"
        >
          <motion.h1 
            className="text-[4vw] font-display font-light text-text-muted tracking-tight"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            exit={{ y: '-50%', opacity: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
          >
            Enterprises need <span className="font-medium text-text-main">smarter voice bots.</span>
          </motion.h1>
        </motion.div>

        <motion.div
          className="h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent w-[20vw] my-4"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          exit={{ scaleX: 0, opacity: 0 }}
          transition={{ duration: 1, delay: 1 }}
        />

        <motion.div className="overflow-hidden mt-6">
          <motion.h2
            className="text-[7vw] font-display font-bold text-gradient leading-none tracking-tighter"
            initial={{ y: '100%', opacity: 0, rotateX: 45 }}
            animate={{ y: '0%', opacity: 1, rotateX: 0 }}
            exit={{ scale: 1.2, opacity: 0, filter: 'blur(10px)' }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 1.2 }}
          >
            Meet VoxAgent.
          </motion.h2>
        </motion.div>
        
        <motion.p
          className="mt-6 text-[1.5vw] font-sans text-text-muted max-w-[40vw]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, delay: 2 }}
        >
          The intelligent control plane for AI voice operations.
        </motion.p>
      </div>

    </motion.div>
  );
};
