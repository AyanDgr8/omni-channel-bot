import { motion } from 'framer-motion';

export const Scene2 = () => {
  return (
    <motion.div
      className="absolute inset-0 w-full h-full flex items-center justify-between px-[10vw] pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: '-5vw' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      
      {/* Left side: Content */}
      <div className="flex flex-col z-10 w-[40vw]">
        <motion.div
          className="inline-block px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary font-medium text-[1vw] mb-6 w-max"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          Agentic Persona Engine
        </motion.div>
        
        <motion.h2
          className="text-[4.5vw] font-display font-bold leading-[1.1] tracking-tight mb-6"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
        >
          Craft rich <br/>
          <span className="text-gradient">AI Personas.</span>
        </motion.h2>

        <motion.div className="flex flex-wrap gap-3 mt-4">
          {['Hotel Receptionist', 'Debt Collector', 'E-commerce Support'].map((role, i) => (
            <motion.div
              key={role}
              className="px-5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-sans text-[1.2vw] shadow-sm"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.8 + (i * 0.15) }}
            >
              {role}
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* Right side: Visuals */}
      <div className="relative w-[40vw] h-[60vh] flex items-center justify-center z-10 perspective-[1000px]">
        {/* Background Image / Abstract */}
        <motion.img
          src={`${import.meta.env.BASE_URL}attached_assets/ai_brain.png`}
          className="absolute w-[120%] h-[120%] object-contain mix-blend-multiply opacity-60 pointer-events-none"
          initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
          animate={{ opacity: 0.6, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 1.1 }}
          transition={{ duration: 2, ease: "easeOut" }}
        />

        {/* UI Mockup element */}
        <motion.div
          className="relative glass-panel rounded-2xl p-6 w-[28vw] shadow-2xl z-20"
          initial={{ opacity: 0, rotateY: 20, x: 100, z: -100 }}
          animate={{ opacity: 1, rotateY: -5, x: 0, z: 0 }}
          exit={{ opacity: 0, rotateY: -20, x: -100 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-primary font-bold">JD</span>
            </div>
            <div>
              <div className="font-display font-bold text-[1.2vw]">Jane Doe</div>
              <div className="text-text-muted text-[0.9vw]">Hotel Concierge</div>
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[0.8vw] font-bold text-slate-400 uppercase tracking-wider">Greeting Style</div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-[1vw] text-slate-700">
                "Warm, professional, mentions time of day."
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[0.8vw] font-bold text-slate-400 uppercase tracking-wider">Interrupt Mode</div>
              <div className="flex items-center gap-2 text-[1vw] font-medium text-emerald-600">
                <div className="w-2 h-2 rounded-full bg-emerald-500" /> Wait for silence
              </div>
            </div>
          </div>
        </motion.div>
      </div>

    </motion.div>
  );
};
