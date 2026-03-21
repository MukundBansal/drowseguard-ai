import { useState, useEffect, useRef } from 'react'
// @ts-ignore
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

type Status = {
  ear: number
  alert_state: string
  fps: number
  session_time: number
}

type LogEvent = {
  time: string
  message: string
  type: 'info' | 'warn' | 'error'
}

type GlobalStats = {
  totalSessions: number
  drowsyEpisodes: number
  earSum: number
  frameCount: number
}

function App() {
  const [status, setStatus] = useState<Status>({
    ear: 0.0,
    alert_state: 'AWAKE',
    fps: 0.0,
    session_time: 0.0
  })

  const [isDetecting, setIsDetecting] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)
  const [logs, setLogs] = useState<LogEvent[]>([])
  
  const [stats, setStats] = useState<GlobalStats>({
    totalSessions: 0,
    drowsyEpisodes: 0,
    earSum: 0,
    frameCount: 0
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null)
  
  // Tracking Refs for ML Loop
  const requestRef = useRef<number | undefined>(undefined)
  const lastVideoTimeRef = useRef<number>(-1)
  const consecutiveFramesRef = useRef(0)
  const startTimeRef = useRef(0)
  const prevTimeRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const EAR_THRESHOLD = 0.25
  const CONSECUTIVE_FRAMES = 20

  const LEFT_EYE = [362, 385, 387, 263, 373, 380]
  const RIGHT_EYE = [33, 160, 158, 133, 153, 144]

  const getEuclideanDistance = (p1: any, p2: any) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2))
  }

  const calculateEAR = (eyeIndices: number[], landmarks: any[]) => {
    const p = eyeIndices.map(i => landmarks[i])
    const A = getEuclideanDistance(p[1], p[5])
    const B = getEuclideanDistance(p[2], p[4])
    const C = getEuclideanDistance(p[0], p[3])
    if (C === 0) return 0.0
    return (A + B) / (2.0 * C)
  }

  const playBeep = () => {
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext
      audioCtxRef.current = new AudioContext()
    }
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') ctx.resume()
    
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(800, ctx.currentTime)
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.15) // short beep
  }

  const addLog = (msg: string, type: 'info' | 'warn' | 'error') => {
    setLogs(prev => {
      const newLog = { 
        time: new Date().toLocaleTimeString([], { hour12: false }), 
        message: msg, 
        type 
      }
      return [newLog, ...prev].slice(0, 8) // Keep last 8 logs
    })
  }

  // Initialize MediaPipe FaceLandmarker
  useEffect(() => {
    const initModel = async () => {
      setIsModelLoading(true)
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        )
        faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
          },
          outputFaceBlendshapes: false,
          runningMode: "VIDEO",
          numFaces: 1
        })
        addLog("AI Model Loaded Successfully", "info")
      } catch (err) {
        console.error(err)
        addLog("Failed to load AI Model", "error")
      } finally {
        setIsModelLoading(false)
      }
    }
    initModel()
  }, [])

  // Start / Stop Camera & Loop
  useEffect(() => {
    let stream: MediaStream | null = null

    const startCamera = async () => {
      if (!videoRef.current || !faceLandmarkerRef.current) return
      
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        videoRef.current.srcObject = stream
        addLog("Camera stream started", "info")
      } catch (err) {
        console.error("Camera access denied", err)
        addLog("Camera Access Denied", "error")
        setIsDetecting(false)
        return
      }

      startTimeRef.current = performance.now()
      prevTimeRef.current = performance.now()
      consecutiveFramesRef.current = 0
      
      setStats(prev => ({ ...prev, totalSessions: prev.totalSessions + 1 }))
      
      // ML loop
      const detectFrame = async () => {
        const video = videoRef.current
        if (!video || !faceLandmarkerRef.current || video.readyState !== 4) {
          requestRef.current = requestAnimationFrame(detectFrame)
          return
        }

        const currTime = performance.now()
        
        // Only process if browser updated video frame
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime

          const result = faceLandmarkerRef.current.detectForVideo(video, currTime)
          
          let currentEar = 0
          let state = 'AWAKE'

          if (result.faceLandmarks && result.faceLandmarks.length > 0) {
            const landmarks = result.faceLandmarks[0]
            const leftEar = calculateEAR(LEFT_EYE, landmarks)
            const rightEar = calculateEAR(RIGHT_EYE, landmarks)
            currentEar = (leftEar + rightEar) / 2.0

            if (currentEar < EAR_THRESHOLD) {
              consecutiveFramesRef.current += 1
              if (consecutiveFramesRef.current >= CONSECUTIVE_FRAMES) {
                state = 'DROWSY'
              } else {
                state = 'WARNING'
              }
            } else if (currentEar >= 0.25 && currentEar < 0.28) {
              consecutiveFramesRef.current = 0
              state = 'WARNING'
            } else {
              consecutiveFramesRef.current = 0
              state = 'AWAKE'
            }
          } else {
            consecutiveFramesRef.current = 0
            state = 'WARNING' // Cannot see face
          }

          // Compute FPS
          const fps = 1000 / (currTime - prevTimeRef.current)
          prevTimeRef.current = currTime
          
          setStats(prev => ({ 
             ...prev, 
             earSum: prev.earSum + currentEar,
             frameCount: prev.frameCount + 1
          }))

          // Audio & Logs Context
          setStatus(prev => {
            if (state === 'DROWSY' && prev.alert_state !== 'DROWSY') {
              playBeep()
              addLog(`DROWSY EPISODE DETECTED! (EAR: ${currentEar.toFixed(2)})`, "error")
              setStats(s => ({ ...s, drowsyEpisodes: s.drowsyEpisodes + 1 }))
            } else if (state === 'DROWSY') {
              if (consecutiveFramesRef.current % 10 === 0) playBeep()
            }
            return {
              ear: currentEar,
              alert_state: state,
              fps: fps,
              session_time: (currTime - startTimeRef.current) / 1000
            }
          })
        }
        
        requestRef.current = requestAnimationFrame(detectFrame)
      }
      
      requestRef.current = requestAnimationFrame(detectFrame)
    }

    if (isDetecting) {
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume()
      }
      startCamera()
    } else {
      // Cleanup
      if (requestRef.current) cancelAnimationFrame(requestRef.current)
      if (videoRef.current) videoRef.current.srcObject = null
      
      addLog("Detection session ended", "info")
      setStatus(prev => ({ ...prev, alert_state: 'AWAKE', ear: 0.0, fps: 0.0 }))
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current)
      if (stream) {
        stream.getTracks().forEach((track: MediaStreamTrack) => track.stop())
      }
    }
  }, [isDetecting])

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "00:00"
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const isDrowsy = status.alert_state === 'DROWSY'
  const isWarning = status.alert_state === 'WARNING'
  
  const stateBgClass = isDrowsy ? 'bg-dg-drowsy' : isWarning ? 'bg-dg-warning' : 'bg-dg-awake'
  const stateTextClass = isDrowsy ? 'text-dg-drowsy' : isWarning ? 'text-dg-warning' : 'text-dg-awake'
  const stateBorderClass = isDrowsy ? 'border-dg-drowsy' : isWarning ? 'border-dg-warning' : 'border-dg-awake'

  // SVG Gauge calculations
  const maxEar = 0.45
  const radius = 60
  const circumference = 2 * Math.PI * radius
  const fillPercentage = Math.min((status.ear / maxEar) * 100, 100)
  const strokeDashoffset = isDetecting ? circumference - (fillPercentage / 100) * circumference : circumference
  
  // Stats calculations
  const avgEar = stats.frameCount > 0 ? (stats.earSum / stats.frameCount).toFixed(3) : "0.000"

  return (
    <div className="min-h-screen bg-[#0A0F1E] text-white font-inter selection:bg-blue-500 selection:text-white">
      {/* Navbar */}
      <nav className="border-b border-white/5 bg-[#0A0F1E]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-[0_0_20px_rgba(79,70,229,0.4)]">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white">
                  <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                  <path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 010-1.113zM17.25 12a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="font-extrabold text-2xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">DrowseGuard AI</span>
            </div>
            <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-gray-400">
              <a href="#dashboard" className="hover:text-white transition-colors">Dashboard</a>
              <a href="#about" className="hover:text-white transition-colors">About Project</a>
            </div>
            <div className="flex items-center">
              <span className="px-3 py-1 bg-blue-500/10 text-blue-400 text-xs font-bold rounded-full border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.2)]">Web Edge Computing</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative overflow-hidden w-full">
        {/* Dynamic deep navy to purple gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0F1E] via-[#10152B] to-[#1A102E] -z-10"></div>
        {/* Massive ambient blurred glowing orb */}
        <div className={`absolute top-0 right-0 -translate-y-1/2 translate-x-1/3 w-[800px] h-[800px] rounded-full blur-[150px] pointer-events-none transition-all duration-700 ${isDrowsy ? 'bg-red-500/20 animate-pulse' : 'bg-indigo-600/15'}`}></div>
        
        <div id="dashboard" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-24 relative z-10 text-center">
          
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6">
            Real-Time Drowsiness Protection, <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 drop-shadow-sm">
              Powered by Browser ML
            </span>
          </h1>
          
          <div className="flex justify-center mb-12">
            <button 
              disabled={isModelLoading}
              onClick={() => setIsDetecting(!isDetecting)}
              className={`cursor-pointer px-10 py-4 ${
                isDetecting 
                  ? 'bg-red-500/10 border border-red-500 text-red-400 shadow-[0_0_30px_-5px_rgba(239,68,68,0.4)] hover:bg-red-500/20' 
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-[0_0_40px_-5px_rgba(79,70,229,0.5)] border border-indigo-500'
              } text-white rounded-2xl font-bold text-lg transition-all transform hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group`}
            >
              {isModelLoading ? (
                <div className="w-5 h-5 border-2 border-t-transparent border-white rounded-full animate-spin"></div>
              ) : isDetecting ? (
                <div className="w-4 h-4 bg-red-400 rounded-sm"></div>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 group-hover:scale-110 transition-transform">
                  <path fillRule="evenodd" d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5z" clipRule="evenodd" />
                </svg>
              )}
              {isModelLoading ? 'Loading AI Model...' : isDetecting ? 'Stop Active Session' : 'Start Camera Detection'}
            </button>
          </div>
          
          {/* Main Dashboard UI */}
          <div className="relative mx-auto max-w-6xl w-full flex flex-col lg:flex-row gap-8">
            
            {/* Live Camera Feed */}
            <div className="flex-1 flex flex-col gap-6">
              <div className={`relative rounded-3xl bg-[#141B2D] border overflow-hidden shadow-2xl transition-all duration-500 z-20 ${isDrowsy ? 'border-red-500 shadow-[0_0_80px_-15px_rgba(239,68,68,0.6)] animate-[pulse_1s_infinite]' : 'border-white/10 shadow-black/80'}`}>
                
                {/* Red pulsing ring interior glow */}
                {isDrowsy && <div className="absolute inset-0 shadow-[inset_0_0_80px_rgba(239,68,68,0.7)] z-10 pointer-events-none mix-blend-screen transition-opacity"></div>}

                <div className="w-full aspect-video bg-black relative flex items-center justify-center overflow-hidden">
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted
                    className={`absolute inset-0 w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-300 ${!isDetecting ? 'opacity-0' : 'opacity-100 mix-blend-screen brightness-110'}`}
                  />
                  
                  {/* Grid Lines for polished look */}
                  <div className="absolute inset-0 opacity-10 bg-[linear-gradient(rgba(255,255,255,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.2)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>
                  
                  {!isDetecting && (
                    <div className="flex flex-col items-center gap-4 text-gray-500">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 opacity-30">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      </svg>
                      <span className="font-semibold tracking-wide uppercase">Hardware Disconnected</span>
                    </div>
                  )}
                  
                  {/* Camera overlays */}
                  {isDetecting && (
                    <>
                      {/* Recording badge */}
                      <div className="absolute top-6 left-6 flex gap-2">
                        <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full ${isDrowsy ? 'bg-red-500 animate-ping' : isWarning ? 'bg-amber-500' : 'bg-green-500 animate-pulse'}`}></div>
                          <span className="text-xs uppercase font-bold tracking-widest text-gray-200">LIVE WEBRTC</span>
                        </div>
                      </div>
                      
                      {/* Technical FPS Output */}
                      <div className="absolute top-6 right-6">
                        <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 flex items-center gap-3">
                           <span className="text-xs font-mono font-medium text-gray-300">{status.fps.toFixed(1)} <span className="text-gray-500">FPS</span></span>
                        </div>
                      </div>

                    </>
                  )}
                </div>
              </div>

              {/* Stats Row Below Camera */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
                <div className="bg-[#141B2D] border border-white/5 rounded-2xl p-5 shadow-lg flex flex-col items-center">
                  <span className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">Total Sessions</span>
                  <span className="text-3xl font-bold font-mono text-white">{stats.totalSessions}</span>
                </div>
                <div className="bg-[#141B2D] border border-white/5 rounded-2xl p-5 shadow-lg flex flex-col items-center relative overflow-hidden">
                  {stats.drowsyEpisodes > 0 && <div className="absolute top-0 right-0 w-16 h-16 bg-red-500/10 rounded-full blur-xl"></div>}
                  <span className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">Drowsy Episodes</span>
                  <span className={`text-3xl font-bold font-mono ${stats.drowsyEpisodes > 0 ? 'text-red-400' : 'text-white'}`}>{stats.drowsyEpisodes}</span>
                </div>
                <div className="bg-[#141B2D] border border-white/5 rounded-2xl p-5 shadow-lg flex flex-col items-center">
                  <span className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">Average EAR</span>
                  <span className="text-3xl font-bold font-mono text-indigo-400">{avgEar}</span>
                </div>
                <div className="bg-[#141B2D] border border-white/5 rounded-2xl p-5 shadow-lg flex flex-col items-center relative overflow-hidden">
                   {isDetecting && <div className="absolute top-0 left-0 w-16 h-16 bg-blue-500/10 rounded-full blur-xl animate-pulse"></div>}
                  <span className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">Current Uptime</span>
                  <span className="text-3xl font-bold font-mono text-white">{formatTime(status.session_time)}</span>
                </div>
              </div>
            </div>
            
            {/* Side Metrics Dashboard */}
            <div className="w-full lg:w-96 flex flex-col gap-6 text-left shrink-0">
              
              {/* Dynamic Status Badge */}
              <div className={`rounded-2xl border p-4 shadow-xl flex items-center justify-between transition-colors duration-500 ${isDrowsy ? 'bg-red-500/10 border-red-500' : isWarning ? 'bg-amber-500/10 border-amber-500/50' : 'bg-[#141B2D] border-white/5'}`}>
                 <div className="flex items-center gap-3">
                   <div className={`p-2 rounded-xl text-white ${stateBgClass}`}>
                     {isDrowsy ? (
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 animate-pulse"><path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm-1.72 6.97a.75.75 0 10-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 101.06 1.06L12 13.06l1.72 1.72a.75.75 0 101.06-1.06L13.06 12l1.72-1.72a.75.75 0 10-1.06-1.06L12 10.94l-1.72-1.72z" clipRule="evenodd" /></svg>
                     ) : isWarning ? (
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" /></svg>
                     ) : (
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" /></svg>
                     )}
                   </div>
                   <div className="flex flex-col">
                     <span className="text-xs text-gray-400 font-semibold tracking-widest uppercase">Driver Condition</span>
                     <span className={`text-xl font-bold tracking-tight transition-colors duration-300 ${stateTextClass}`}>{isDetecting ? status.alert_state : 'STANDBY'}</span>
                   </div>
                 </div>
              </div>

              {/* SVG Circular EAR Gauge */}
              <div className="bg-[#141B2D] border border-white/5 rounded-2xl p-8 shadow-xl relative overflow-hidden flex flex-col items-center">
                {isDrowsy && <div className="absolute inset-0 bg-red-500/5 animate-pulse pointer-events-none"></div>}
                
                <h3 className="text-xs text-gray-400 uppercase font-bold tracking-widest mb-6 self-start w-full text-left flex justify-between">
                  <span>Eye Aspect Ratio (EAR)</span>
                </h3>
                
                <div className="relative w-48 h-48 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="96" cy="96" r={radius} className="stroke-gray-800" strokeWidth="12" fill="transparent" />
                    {/* The dynamic colored progress ring */}
                    <circle 
                      cx="96" cy="96" r={radius} 
                      className={`transition-all duration-300 ease-out ${stateBorderClass}`} 
                      strokeWidth="12" fill="transparent" 
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                    />
                    {/* The threshold target marker positioned geometrically (e.g., at 0.25 -> 55%) */}
                    {isDetecting && (
                      <circle 
                         cx="96" cy="96" r={radius - 6} 
                         className="stroke-red-500/80" 
                         strokeWidth="2" fill="transparent"
                         strokeDasharray={`1 ${circumference}`}
                         strokeDashoffset={circumference - (0.25 / 0.45) * circumference}
                      />
                    )}
                  </svg>
                  
                  {/* Absolute Center Text */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-5xl font-black tabular-nums tracking-tighter transition-colors duration-300 ${stateTextClass}`}>
                      {isDetecting ? status.ear.toFixed(3) : '0.00'}
                    </span>
                    <span className="text-gray-500 text-[10px] font-bold mt-1 tracking-widest">THRESHOLD: 0.25</span>
                  </div>
                </div>
              </div>

              {/* Event Logs */}
              <div className="bg-[#141B2D] border border-white/5 rounded-2xl p-6 shadow-xl flex-1 flex flex-col min-h-[250px]">
                <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
                  <div className="text-xs text-gray-400 uppercase font-bold tracking-widest">Active Session Logs</div>
                  {isDetecting && <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] animate-pulse"></div>}
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-4 font-mono text-xs">
                  {logs.length === 0 ? (
                     <div className="text-gray-600 italic text-center mt-10">Waiting for live events...</div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className="flex gap-4">
                        <div className="text-gray-500 shrink-0">{log.time}</div>
                        <div className={`flex items-start gap-2 ${log.type === 'error' ? 'text-red-400 font-semibold' : log.type === 'warn' ? 'text-amber-400' : 'text-gray-300'}`}>
                          {log.type === 'error' ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mt-0.5 shrink-0"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" /></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mt-0.5 opacity-50 shrink-0"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" /></svg>
                          )}
                          <span>{log.message}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
          
        </div>
      </main>

      {/* ABOUT SECTION - Premium Product Pitch */}
      <section id="about" className="relative py-24 bg-[#0A0F1E] border-t border-white/5 overflow-hidden">
        {/* Decorative Grid */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDQwIEwgNDAgNDAgTCA0MCAwIiBmaWxsPSJub25lIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] pointer-events-none opacity-50"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          
          <div className="inline-block px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-bold text-xs uppercase tracking-widest mb-6">
            Final Year PBL Project
          </div>
          
          <h2 className="text-3xl md:text-5xl font-extrabold mb-4 select-all">DrowseGuard AI</h2>
          <p className="text-xl text-gray-400 font-semibold mb-16 tracking-wide">Developed at <span className="text-white">Chitkara University</span></p>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-5xl mx-auto mb-24">
            <div className="flex flex-col gap-2 relative">
              <span className="text-indigo-400 text-3xl md:text-4xl font-black tabular-nums tracking-tighter">&lt;20ms</span>
              <span className="text-gray-500 font-bold text-xs tracking-widest uppercase">Detection Speed</span>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-12 bg-white/10 hidden md:block"></div>
            </div>
            <div className="flex flex-col gap-2 relative">
              <span className="text-indigo-400 text-3xl md:text-4xl font-black tabular-nums tracking-tighter">90%+</span>
              <span className="text-gray-500 font-bold text-xs tracking-widest uppercase">Accuracy Rate</span>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-12 bg-white/10 hidden md:block"></div>
            </div>
            <div className="flex flex-col gap-2 relative">
              <span className="text-indigo-400 text-3xl md:text-4xl font-black tabular-nums tracking-tighter">478</span>
              <span className="text-gray-500 font-bold text-xs tracking-widest uppercase">Landmarks Tracked</span>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-12 bg-white/10 hidden md:block"></div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-indigo-400 text-3xl md:text-4xl font-black tracking-tighter">Live</span>
              <span className="text-gray-500 font-bold text-xs tracking-widest uppercase">Real-Time Processing</span>
            </div>
          </div>

          {/* How It Works Layer */}
          <div className="mb-24">
            <h3 className="text-2xl font-bold mb-10 text-white">How The Algorithm Works</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-[#141B2D]/50 border border-white/5 rounded-3xl p-8 hover:bg-[#141B2D] transition-colors text-left flex flex-col items-start shadow-xl">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center font-black text-xl mb-6">1</div>
                <h4 className="text-lg font-bold text-white mb-3">Live Video Buffering</h4>
                <p className="text-gray-400 leading-relaxed text-sm">We access the hardware securely via WebRTC, slicing continuous frame buffers dynamically on the frontend canvas layer securely without exposing private streams.</p>
              </div>
              <div className="bg-[#141B2D]/50 border border-white/5 rounded-3xl p-8 hover:bg-[#141B2D] transition-colors text-left flex flex-col items-start shadow-xl">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-black text-xl mb-6">2</div>
                <h4 className="text-lg font-bold text-white mb-3">Machine Learning Graph</h4>
                <p className="text-gray-400 leading-relaxed text-sm">A lightweight TensorFlow WASM graph parses 478 intricate 3D spatial points predicting depth matrix landmarks across jawlines, irises, and eyelids.</p>
              </div>
              <div className="bg-[#141B2D]/50 border border-white/5 rounded-3xl p-8 hover:bg-[#141B2D] transition-colors text-left flex flex-col items-start shadow-xl">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center font-black text-xl mb-6">3</div>
                <h4 className="text-lg font-bold text-white mb-3">Euclidean Mathematical Calculation</h4>
                <p className="text-gray-400 leading-relaxed text-sm">Translating physical vectors using Eye Aspect Ratio formulas calculating the scalar differentials separating vertical and lateral eye node vertices sequentially.</p>
              </div>
            </div>
          </div>

          {/* Technology Stack Tags */}
          <div>
            <h3 className="text-2xl font-bold mb-8 text-white">Core Technology Stack</h3>
            <div className="flex flex-wrap items-center justify-center gap-4 max-w-4xl mx-auto">
              {['MediaPipe', 'TensorFlow.js', 'React.js', 'FastAPI', 'Vite', 'WebAssembly', 'Python', 'TailwindCSS'].map(tech => (
                <div key={tech} className="px-5 py-2.5 rounded-full bg-white/5 border border-white/10 text-gray-300 font-semibold shadow-lg hover:border-white/20 transition-all cursor-default">{tech}</div>
              ))}
            </div>
          </div>

        </div>
      </section>

      <footer className="py-8 bg-[#0A0F1E] border-t border-white/5 text-center text-sm font-semibold text-gray-500">
        &copy; {new Date().getFullYear()} DrowseGuard AI &bull; Created for Final Year PBL &bull; Chitkara University
      </footer>
    </div>
  )
}

export default App
