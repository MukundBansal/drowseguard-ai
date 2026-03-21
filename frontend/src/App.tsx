import { useState, useEffect } from 'react'

type Status = {
  ear: number
  alert_state: string
  fps: number
  session_time: number
}

function App() {
  const [status, setStatus] = useState<Status>({
    ear: 0.0,
    alert_state: 'AWAKE',
    fps: 0.0,
    session_time: 0.0
  })

  const [isDetecting, setIsDetecting] = useState(false)

  useEffect(() => {
    let interval: number | undefined
    
    if (isDetecting) {
      interval = window.setInterval(async () => {
        try {
          const res = await fetch('https://drowseguardai.onrender.com/status')
          if (res.ok) {
            const data = await res.json()
            setStatus(data)
          }
        } catch (err) {
          console.error('Failed to fetch status:', err)
        }
      }, 500)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isDetecting])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const isDrowsy = status.alert_state === 'DROWSY'
  const isWarning = status.alert_state === 'WARNING'
  const stateBgClass = isDrowsy ? 'bg-dg-drowsy' : isWarning ? 'bg-dg-warning' : 'bg-dg-awake'
  const stateTextClass = isDrowsy ? 'text-dg-drowsy' : isWarning ? 'text-dg-warning' : 'text-dg-awake'

  return (
    <div className="min-h-screen bg-dg-bg text-white font-inter selection:bg-dg-primary selection:text-white pb-20">
      {/* Navbar */}
      <nav className="border-b border-dg-card/50 bg-dg-bg/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-dg-primary flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
                  <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                  <path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 010-1.113zM17.25 12a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="font-bold text-xl tracking-tight">DrowseGuard AI</span>
            </div>
            <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-300">
              <a href="#features" className="hover:text-white transition-colors">Features</a>
              <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
              <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            </div>
            <div className="flex items-center">
              <button className="text-sm font-medium bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors cursor-pointer">
                Sign In
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative overflow-hidden w-full">
        {/* Background glow effects */}
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[120px] pointer-events-none transition-colors duration-700 ${isDrowsy ? 'bg-dg-drowsy/20' : 'bg-dg-primary/20'}`}></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-32 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-dg-card border border-white/10 text-sm text-gray-300 mb-8 shadow-xl">
            <span className="flex h-2 w-2 relative">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isDetecting ? stateBgClass : 'bg-gray-500'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isDetecting ? stateBgClass : 'bg-gray-500'}`}></span>
            </span>
            {isDetecting ? 'Live Session Active' : 'Real-Time Drowsiness Detection System'}
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8">
            AI That Watches So You <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-dg-primary to-purple-400">
              Don't Fall Asleep
            </span>
          </h1>
          
          <p className="max-w-2xl mx-auto text-lg md:text-xl text-gray-400 mb-10 leading-relaxed">
            Protect yourself and others on the road. DrowseGuard AI uses advanced computer vision to monitor micro-sleeps, yawning, and eye closure in real-time—alerting you instantly before disaster strikes.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button 
              onClick={() => setIsDetecting(!isDetecting)}
              className={`cursor-pointer w-full sm:w-auto px-8 py-4 ${
                isDetecting 
                  ? 'bg-dg-drowsy hover:bg-red-600 shadow-[0_0_40px_-10px_rgba(239,68,68,0.6)]' 
                  : 'bg-dg-primary hover:bg-blue-600 shadow-[0_0_40px_-10px_rgba(59,130,246,0.6)]'
              } text-white rounded-xl font-semibold text-lg transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5z" clipRule="evenodd" />
              </svg>
              {isDetecting ? 'Stop Detection' : 'Start Detection'}
            </button>
            <button className="w-full sm:w-auto px-8 py-4 bg-dg-card hover:bg-white/10 cursor-pointer text-white rounded-xl font-semibold text-lg border border-white/10 transition-all">
              View Demo
            </button>
          </div>
          
          {/* Dashboard Preview mockup */}
          <div className="mt-24 relative mx-auto max-w-5xl">
            <div className={`absolute -inset-1 rounded-2xl blur opacity-20 transition-all duration-500 ${isDrowsy ? 'bg-dg-drowsy animate-pulse opacity-50' : 'bg-gradient-to-r from-dg-primary to-purple-600'}`}></div>
            <div className={`relative rounded-2xl bg-dg-card border p-2 shadow-2xl overflow-hidden transition-all duration-500 ${isDrowsy ? 'border-dg-drowsy/50 shadow-[0_0_50px_-12px_rgba(239,68,68,0.5)]' : 'border-white/10'}`}>
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
              
              <div className="bg-[#0f1422] rounded-xl overflow-hidden aspect-video relative flex items-center justify-center border border-white/5">
                {/* Mockup UI Elements inside */}
                <div className="absolute top-4 left-4 flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-dg-drowsy"></div>
                  <div className="w-3 h-3 rounded-full bg-dg-warning"></div>
                  <div className="w-3 h-3 rounded-full bg-dg-awake"></div>
                </div>
                
                <div className="text-center">
                  <div className={`w-32 h-32 rounded-full border-4 mx-auto mb-6 flex items-center justify-center transition-colors duration-300 ${isDetecting ? 'border-t-transparent animate-[spin_3s_linear_infinite] ' + (isDrowsy ? 'border-dg-drowsy' : isWarning ? 'border-dg-warning' : 'border-dg-awake') : 'border-gray-700'}`}>
                    {isDetecting && (
                      <div className={`w-full h-full rounded-full border-4 animate-[spin_2s_linear_infinite_reverse] ${isDrowsy ? 'border-dg-drowsy border-l-transparent' : isWarning ? 'border-dg-warning border-l-transparent' : 'border-dg-awake border-l-transparent'}`}></div>
                    )}
                  </div>
                  
                  <p className="text-gray-400 font-medium tracking-wide text-sm bg-black/40 px-4 py-2 rounded-full inline-block backdrop-blur-md">
                    {isDetecting ? `Camera Active • ${status.fps.toFixed(1)} FPS` : 'Camera Inactive • Standby'}
                  </p>
                  
                  {isDetecting && (
                    <div className="mt-6 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <span className="text-xs text-gray-500 uppercase font-bold tracking-widest mb-1">Live EAR</span>
                      <span className={`text-5xl font-black tabular-nums transition-colors duration-300 ${stateTextClass}`}>
                        {status.ear.toFixed(3)}
                      </span>
                    </div>
                  )}
                </div>
                
                {/* Status metrics side panel */}
                <div className="absolute right-0 top-0 bottom-0 w-72 bg-dg-card/80 border-l border-white/5 backdrop-blur-md p-6 flex-col gap-8 hidden md:flex text-left">
                  <div className="mt-2">
                    <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-3">Driver State</div>
                    <div className={`flex items-center gap-3 text-lg font-bold transition-colors ${stateTextClass}`}>
                      <div className="relative">
                        {isDetecting && <div className={`absolute -inset-1 rounded-full blur animate-pulse ${stateBgClass}`}></div>}
                        <div className={`relative w-3 h-3 rounded-full ${isDetecting ? stateBgClass : 'bg-gray-600'}`}></div>
                      </div>
                      {isDetecting ? status.alert_state : 'STANDBY'}
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-3 flex justify-between">
                      <span>Eye Aspect Ratio</span>
                      <span className="text-gray-400">{status.ear.toFixed(3)}</span>
                    </div>
                    <div className="w-full bg-black/50 rounded-full h-3 mb-2 overflow-hidden relative border border-white/5">
                      <div 
                        className={`h-full rounded-full transition-all duration-300 ease-out ${isDetecting ? stateBgClass : 'bg-gray-700'}`} 
                        style={{ width: `${Math.min(100, Math.max(0, (status.ear / 0.4) * 100))}%` }}
                      ></div>
                      {/* Threshold marker */}
                      <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10" style={{ left: `${(0.25 / 0.4) * 100}%` }}></div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 font-medium">
                      <span>0.00</span>
                      <span className="text-red-400 ml-4">0.25 Threshold</span>
                      <span>0.40+</span>
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-3">Session Time</div>
                    <div className={`text-3xl font-mono font-bold tracking-tight ${isDetecting ? 'text-white' : 'text-gray-600'}`}>
                      {formatTime(status.session_time)}
                    </div>
                  </div>
                  
                  <div className="mt-auto pt-4 border-t border-white/5 space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Backend Status</span>
                      <span className="text-dg-awake font-medium">Connected</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Model</span>
                      <span className="text-gray-400">FaceLandmarker_v1.task</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
