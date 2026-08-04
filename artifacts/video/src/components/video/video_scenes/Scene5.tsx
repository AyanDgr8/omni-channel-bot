import { motion } from 'framer-motion';

export const Scene5 = () => {
  // Mock data for the fleet dashboard
  const bots = [
    { id: '1', name: 'Alpha Node', status: 'Online', calls: 142, dir: 'Inbound' },
    { id: '2', name: 'Beta Node', status: 'Busy', calls: 89, dir: 'Outbound' },
    { id: '3', name: 'Gamma Node', status: 'Online', calls: 210, dir: 'Mixed' },
    { id: '4', name: 'Delta Node', status: 'Online', calls: 56, dir: 'Inbound' },
  ];

  return (
    <motion.div
      className="absolute inset-0 w-full h-full flex flex-col items-center justify-center px-[5vw] pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      
      <motion.div
        className="text-center mb-[6vh] z-20"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -20, opacity: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        <h2 className="text-[3.5vw] font-display font-bold text-slate-800 tracking-tight">
          Command your <span className="text-primary">Fleet.</span>
        </h2>
        <p className="text-[1.2vw] text-slate-500 mt-2">Real-time bot network visibility and SIP configuration.</p>
      </motion.div>

      {/* Dashboard Grid Mockup */}
      <div className="w-[80vw] z-20 grid grid-cols-4 gap-4">
        {bots.map((bot, i) => (
          <motion.div
            key={bot.id}
            className="glass-panel rounded-2xl p-5 border border-white/40 shadow-xl relative overflow-hidden"
            initial={{ opacity: 0, y: 50, rotateX: 20 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ duration: 0.8, type: "spring", delay: 0.4 + (i * 0.1) }}
          >
            {/* Status Indicator */}
            <div className="absolute top-4 right-4 flex items-center gap-1.5">
              <motion.div 
                className={`w-2 h-2 rounded-full ${bot.status === 'Online' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
              />
              <span className="text-[0.7vw] font-bold text-slate-400 uppercase">{bot.status}</span>
            </div>

            <div className="text-[1.2vw] font-bold text-slate-800 mb-1">{bot.name}</div>
            <div className="text-[0.8vw] text-slate-500 mb-6">{bot.dir} Traffic</div>

            <div className="flex justify-between items-end">
              <div>
                <div className="text-[0.7vw] font-bold text-slate-400 uppercase mb-1">Active Calls</div>
                <div className="text-[2vw] font-display font-bold text-primary leading-none">
                  {bot.calls}
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

    </motion.div>
  );
};
