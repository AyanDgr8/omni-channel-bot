import { motion } from 'framer-motion';

export const Scene4 = () => {
  return (
    <motion.div
      className="absolute inset-0 w-full h-full flex items-center justify-center px-[8vw] pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: 50 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      
      {/* Background Graphic */}
      <motion.img
        src={`${import.meta.env.BASE_URL}attached_assets/dashboard_abstract.png`}
        className="absolute right-0 top-0 w-[60vw] h-full object-cover mix-blend-multiply opacity-30 z-0 pointer-events-none"
        initial={{ opacity: 0, x: 100 }}
        animate={{ opacity: 0.4, x: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
      />

      <div className="flex flex-col w-[35vw] z-20">
        <motion.h2
          className="text-[4vw] font-display font-bold leading-tight tracking-tight text-slate-800"
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          Every call <br/>
          <span className="text-secondary">understood.</span>
        </motion.h2>

        <motion.p
          className="text-[1.2vw] text-slate-500 mt-4 leading-relaxed max-w-[30vw]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
        >
          Rich intelligence stamped on every interaction. Real-time dispositions, barge-in metrics, and dynamic multilingual analysis.
        </motion.p>
      </div>

      <div className="w-[45vw] z-20 flex flex-col gap-4">
        {/* Mock Call Row */}
        <motion.div
          className="w-full bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden"
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.8, type: "spring", bounce: 0.4, delay: 0.6 }}
        >
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="font-bold text-[1vw] text-slate-800">+1 (555) 019-2834</div>
                <div className="text-[0.8vw] text-slate-500">Outbound • Human Answered</div>
              </div>
            </div>
            <div className="px-3 py-1 bg-primary/10 text-primary rounded-full text-[0.8vw] font-bold">
              Sale Closed
            </div>
          </div>
          
          <motion.div 
            className="p-5 flex gap-6 bg-white"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.2, ease: "easeOut" }}
          >
            <div className="flex-1 space-y-3">
              <div>
                <div className="text-[0.7vw] font-bold text-slate-400 uppercase">Summary</div>
                <div className="text-[0.9vw] text-slate-700 mt-1 leading-snug">
                  Customer verified account details and agreed to the premium upgrade. Handled objection regarding price gracefully.
                </div>
              </div>
            </div>
            <div className="w-px bg-slate-100" />
            <div className="w-[12vw] space-y-3">
               <div>
                 <div className="text-[0.7vw] font-bold text-slate-400 uppercase">Language Switches</div>
                 <div className="text-[1vw] font-bold text-slate-700 flex gap-2 items-center mt-1">
                   EN <svg className="w-3 h-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg> ES
                 </div>
               </div>
               <div>
                 <div className="text-[0.7vw] font-bold text-slate-400 uppercase">Barge-ins</div>
                 <div className="text-[1vw] font-bold text-amber-500">2 detected</div>
               </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

    </motion.div>
  );
};
