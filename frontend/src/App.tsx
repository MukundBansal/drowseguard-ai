import { useState, useEffect, useRef } from 'react'
// @ts-ignore
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import confetti from 'canvas-confetti'
import { Eye, Brain, Bell, AlertTriangle, CheckCircle, Skull, Cpu, Camera, Clock, Activity, Github, Linkedin, Mail, ShieldAlert, LogOut } from 'lucide-react'
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { auth, googleProvider } from './firebase'
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'

type Status = {
  ear: number
  mar: number
  alert_state: 'AWAKE' | 'WARNING' | 'YAWNING' | 'DROWSY' | 'CRITICAL' | 'STANDBY'
  fps: number
  session_time: number
}

type LogEvent = {
  id: number
  time: string
  message: string
  type: 'info' | 'warn' | 'error'
}

type GlobalStats = {
  totalSessions: number
  drowsyEpisodes: number
  yawnEpisodes: number
  earSum: number
  frameCount: number
}

function Dashboard({ user, handleSignOut }: { user: User, handleSignOut: () => void }) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [status, setStatus] = useState<Status>({
    ear: 0.0,
    mar: 0.0,
    alert_state: 'STANDBY',
    fps: 0.0,
    session_time: 0.0
  })

  const [isDetecting, setIsDetecting] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)
  const [logs, setLogs] = useState<LogEvent[]>([])
  const [scrolled, setScrolled] = useState(false)
  const [showToast, setShowToast] = useState(false)
  
  const [stats, setStats] = useState<GlobalStats>({
    totalSessions: 0,
    drowsyEpisodes: 0,
    yawnEpisodes: 0,
    earSum: 0,
    frameCount: 0
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null)
  
  // Tracking Refs for ML Loop
  const requestRef = useRef<number | undefined>(undefined)
  const lastVideoTimeRef = useRef<number>(-1)
  const consecutiveFramesRef = useRef(0)
  const consecutiveYawnFramesRef = useRef(0)
  const startTimeRef = useRef(0)
  const prevTimeRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const logIdRef = useRef(0)

  const EAR_THRESHOLD = 0.25
  const CONSECUTIVE_FRAMES = 20
  const MAR_THRESHOLD = 0.6
  const YAWN_CONSECUTIVE_FRAMES = 15

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

  const calculateMAR = (landmarks: any[]) => {
    const p1 = landmarks[78], p2 = landmarks[82], p3 = landmarks[13], p4 = landmarks[312]
    const p5 = landmarks[308], p6 = landmarks[317], p7 = landmarks[14], p8 = landmarks[87]
    const A = getEuclideanDistance(p2, p8)
    const B = getEuclideanDistance(p3, p7)
    const C = getEuclideanDistance(p4, p6)
    const distCorners = getEuclideanDistance(p1, p5)
    if (distCorners === 0) return 0.0
    return (A + B + C) / (2.0 * distCorners)
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
    osc.stop(ctx.currentTime + 0.15)
  }

  const addLog = (msg: string, type: 'info' | 'warn' | 'error') => {
    logIdRef.current += 1
    const newLog = { 
      id: logIdRef.current,
      time: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' }), 
      message: msg, 
      type 
    }
    setLogs(prev => [newLog, ...prev].slice(0, 15))
  }

  // Scroll handler for Navbar
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

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
      consecutiveYawnFramesRef.current = 0
      
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
          let currentMar = 0
          let state: 'AWAKE' | 'WARNING' | 'YAWNING' | 'DROWSY' | 'CRITICAL' = 'AWAKE'

          if (result.faceLandmarks && result.faceLandmarks.length > 0) {
            const landmarks = result.faceLandmarks[0]
            currentEar = (calculateEAR(LEFT_EYE, landmarks) + calculateEAR(RIGHT_EYE, landmarks)) / 2.0
            currentMar = calculateMAR(landmarks)

            const isEyeClosed = currentEar < EAR_THRESHOLD
            const isYawning = currentMar > MAR_THRESHOLD

            if (isEyeClosed) consecutiveFramesRef.current += 1
            else consecutiveFramesRef.current = 0

            if (isYawning) consecutiveYawnFramesRef.current += 1
            else consecutiveYawnFramesRef.current = 0

            const triggeredDrowsy = consecutiveFramesRef.current >= CONSECUTIVE_FRAMES
            const triggeredYawn = consecutiveYawnFramesRef.current >= YAWN_CONSECUTIVE_FRAMES

            if (triggeredDrowsy && triggeredYawn) {
              state = 'CRITICAL'
            } else if (triggeredDrowsy) {
              state = 'DROWSY'
            } else if (triggeredYawn) {
              state = 'YAWNING'
            } else if (currentEar < 0.28 || currentMar > 0.4) {
              state = 'WARNING'
            } else {
              state = 'AWAKE'
            }
          } else {
            consecutiveFramesRef.current = 0
            consecutiveYawnFramesRef.current = 0
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
            if (state === 'CRITICAL' && prev.alert_state !== 'CRITICAL') {
              playBeep(); setTimeout(playBeep, 200)
              addLog(`⚠️ Critical: Eyes + Yawn (EAR: ${currentEar.toFixed(2)}, MAR: ${currentMar.toFixed(2)})`, "error")
              setStats(s => ({ ...s, drowsyEpisodes: s.drowsyEpisodes + 1, yawnEpisodes: s.yawnEpisodes + 1 }))
              setShowToast(true); setTimeout(() => setShowToast(false), 4000)
            } else if (state === 'DROWSY' && prev.alert_state !== 'DROWSY' && prev.alert_state !== 'CRITICAL') {
              playBeep()
              addLog(`😴 Drowsy detected (EAR: ${currentEar.toFixed(2)})`, "error")
              setStats(s => ({ ...s, drowsyEpisodes: s.drowsyEpisodes + 1 }))
              setShowToast(true); setTimeout(() => setShowToast(false), 4000)
            } else if (state === 'YAWNING' && prev.alert_state !== 'YAWNING' && prev.alert_state !== 'CRITICAL') {
              addLog(`🥱 Yawn detected (MAR: ${currentMar.toFixed(2)})`, "warn")
              setStats(s => ({ ...s, yawnEpisodes: s.yawnEpisodes + 1 }))
            } else if (state === 'CRITICAL' || state === 'DROWSY') {
              if (consecutiveFramesRef.current % 10 === 0) playBeep()
            }
            
            return {
              ear: currentEar,
              mar: currentMar,
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
      
      if (status.alert_state !== 'STANDBY') {
        addLog("Detection session ended securely", "info")
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#3B82F6', '#22C55E', '#8B5CF6']
        })
      }
      setStatus(prev => ({ ...prev, alert_state: 'STANDBY', ear: 0.0, fps: 0.0 }))
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current)
      if (stream) {
        stream.getTracks().forEach((track: MediaStreamTrack) => track.stop())
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDetecting])

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "00:00"
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const isDrowsy = status.alert_state === 'DROWSY'
  const isWarning = status.alert_state === 'WARNING'
  const isYawning = status.alert_state === 'YAWNING'
  const isCritical = status.alert_state === 'CRITICAL'
  const isStandby = status.alert_state === 'STANDBY'
  
  const stateColor = isCritical ? '#DC2626' : isDrowsy ? '#EF4444' : isYawning ? '#F97316' : isWarning ? '#F59E0B' : isStandby ? '#64748B' : '#3B82F6'
  const glowBorderClass = isCritical ? 'border-red-600 shadow-[0_0_50px_-5px_rgba(220,38,38,0.9)] animate-pulse' :
                          isDrowsy ? 'border-red-500 shadow-[0_0_40px_-5px_rgba(239,68,68,0.7)]' : 
                          isYawning ? 'border-orange-500 shadow-[0_0_40px_-5px_rgba(249,115,22,0.7)]' :
                          isWarning ? 'border-amber-500 shadow-[0_0_30px_-5px_rgba(245,158,11,0.5)]' : 
                          isStandby ? 'border-white/10 shadow-lg' :
                          'border-blue-500 shadow-[0_0_30px_-5px_rgba(59,130,246,0.3)]'

  const avgEar = stats.frameCount > 0 ? (stats.earSum / stats.frameCount).toFixed(3) : "0.000"

  // Semicircular Gauge calculations
  const radius = 55
  const circumference = Math.PI * radius
  
  const maxEar = 0.45
  const fillPercentageEar = isDetecting ? Math.min((status.ear / maxEar) * 100, 100) : 0
  const activeDashOffsetEar = circumference - (fillPercentageEar / 100) * circumference
  const thresholdAngleEar = ((0.25 / 0.45) * 180) - 90

  const maxMar = 1.0
  const fillPercentageMar = isDetecting ? Math.min((status.mar / maxMar) * 100, 100) : 0
  const activeDashOffsetMar = circumference - (fillPercentageMar / 100) * circumference
  const thresholdAngleMar = ((0.6 / 1.0) * 180) - 90

  return (
    <div className="min-h-screen bg-dg-bg text-white font-inter selection:bg-blue-500 selection:text-white bg-grid-pattern overflow-x-hidden animate-fade-up">
      
      {/* Toast Notification */}
      <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 transform ${showToast ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-10 opacity-0 scale-95 pointer-events-none'}`}>
        <div className="bg-red-500/90 backdrop-blur-md border border-red-400 text-white px-6 py-3 rounded-2xl shadow-[0_10px_40px_-10px_rgba(239,68,68,0.8)] flex items-center gap-3">
          <ShieldAlert className="w-6 h-6 animate-pulse" />
          <span className="font-bold tracking-wide">⚠️ Drowsiness Detected! Please take a break.</span>
        </div>
      </div>

      {/* Sticky Navbar */}
      <nav className={`fixed w-full top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-[#0A0F1E]/60 backdrop-blur-2xl border-b border-blue-500/30 shadow-[0_4px_30px_-10px_rgba(59,130,246,0.2)]' : 'bg-transparent border-b border-transparent'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                <Eye className="w-6 h-6 text-white" />
              </div>
              <span className="font-extrabold text-2xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">DrowseGuard AI</span>
            </div>
            <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-gray-300">
              <a href="#hero" className="hover:text-white transition-colors">Home</a>
              <a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a>
              <a href="#dashboard" className="hover:text-white transition-colors">Dashboard</a>
              <a href="#about" className="hover:text-white transition-colors">About</a>
            </div>
            <div className="flex items-center relative">
              <button onClick={() => setShowDropdown(!showDropdown)} className="w-10 h-10 rounded-full border-2 border-white/10 hover:border-blue-500 overflow-hidden transition-all shadow-lg active:scale-95 focus:outline-none">
                <img src={user.photoURL || ''} alt="User" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </button>

              {showDropdown && (
                <div className="absolute right-0 top-14 mt-2 w-56 bg-[#141B2D]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl py-2 z-50 animate-fade-up">
                  <div className="px-4 py-3 border-b border-white/5">
                    <p className="text-[10px] text-gray-500 font-bold tracking-widest uppercase mb-1">Signed In As</p>
                    <p className="text-sm font-semibold text-white truncate">{user.displayName}</p>
                  </div>
                  <div className="px-2 py-2">
                    <button 
                      onClick={() => { setShowDropdown(false); handleSignOut(); }}
                      className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-500/10 rounded-xl font-medium transition-colors text-sm flex items-center gap-2"
                    >
                      <LogOut className="w-4 h-4" /> Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main id="hero" className="relative h-screen min-h-[800px] flex items-center justify-center overflow-hidden w-full pt-16">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#10152B]/50 to-[#0A0F1E] z-0"></div>
        {/* Animated Orbs */}
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px] mix-blend-screen animate-pulse z-0 pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[150px] mix-blend-screen animate-pulse delay-300 z-0 pointer-events-none"></div>
        
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center flex flex-col items-center">
          <h1 className="text-6xl md:text-8xl font-black tracking-tight mb-8 leading-[1.1]">
            <span className="block text-white animate-fade-up">AI That Watches</span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 animate-fade-up delay-100 pb-2 drop-shadow-lg">So You Don't</span>
            <span className="block text-white animate-fade-up delay-200">Fall Asleep</span>
          </h1>
          
          <p className="max-w-2xl mx-auto text-xl text-gray-400 font-medium mb-12 animate-fade-up delay-300">
            Enterprise-grade driver safety powered by real-time neural networks in your browser. Detecting micro-sleeps before disasters strike.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 animate-fade-up delay-[400ms]">
            <a href="#dashboard" className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl font-bold text-lg shadow-[0_0_40px_-10px_rgba(59,130,246,0.6)] transition-all transform hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-2">
              Start Detection
            </a>
            <a href="#how-it-works" className="w-full sm:w-auto px-8 py-4 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white rounded-2xl font-bold text-lg transition-all transform hover:-translate-y-1 active:scale-95">
              View Demo
            </a>
          </div>

          <div className="mt-16 flex flex-wrap justify-center gap-6 text-sm font-semibold text-gray-400 animate-fade-up delay-[500ms]">
            <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full border border-white/5">
              <Cpu className="w-4 h-4 text-blue-400" /> 25ms Response
            </div>
            <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full border border-white/5">
              <Eye className="w-4 h-4 text-purple-400" /> Powered by EAR + MAR Detection
            </div>
            <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full border border-white/5">
              <ShieldAlert className="w-4 h-4 text-green-400" /> 99% Uptime
            </div>
          </div>
        </div>
      </main>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold text-white">How DrowseGuard AI Works</h2>
            <div className="w-20 h-1 bg-gradient-to-r from-blue-500 to-purple-500 mx-auto mt-6 rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Connecting line for desktop */}
            <div className="hidden md:block absolute top-[60px] left-[15%] right-[15%] h-0.5 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-red-500/20 z-0"></div>

            {[
              { icon: <Camera />, title: 'Face Captured', desc: 'Webcam accesses your face in real time at 30 frames per second.', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
              { icon: <Brain />, title: 'AI Analyzes', desc: '478 facial landmarks tracked using MediaPipe FaceMesh technology.', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
              { icon: <Bell />, title: 'Alert Triggered', desc: 'EAR dropping below 0.25 threshold triggers instant audio-visual warnings.', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
            ].map((step, i) => (
              <div key={i} className="relative z-10 bg-dg-card backdrop-blur-xl border border-white/10 p-8 rounded-3xl hover:-translate-y-2 transition-transform duration-300 group shadow-xl">
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                <div className={`w-16 h-16 rounded-2xl ${step.bg} ${step.border} border flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:scale-110 transition-transform ${step.color}`}>
                  {step.icon}
                </div>
                <h3 className="text-xl font-bold text-white mb-3 text-center">{step.title}</h3>
                <p className="text-gray-400 text-center text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DASHBOARD */}
      <section id="dashboard" className="py-20 relative z-10 bg-[#060913]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-end mb-10">
            <div>
              <h2 className="text-3xl md:text-5xl font-extrabold text-white">Live Detection Dashboard</h2>
              <p className="text-gray-400 mt-3 font-medium">Running highly optimized inference on WebGL limits.</p>
            </div>
            
            <button 
              disabled={isModelLoading}
              onClick={() => setIsDetecting(!isDetecting)}
              className={`hidden md:flex cursor-pointer px-8 py-3.5 ${
                isDetecting 
                  ? 'bg-red-500/10 border border-red-500/50 text-red-500 hover:bg-red-500/20' 
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-[0_0_20px_-5px_rgba(59,130,246,0.5)] border border-transparent'
              } text-white rounded-xl font-bold transition-all transform hover:scale-105 active:scale-95 items-center justify-center gap-3 disabled:opacity-50`}
            >
              {isModelLoading ? (
                <div className="w-5 h-5 border-2 border-t-transparent border-white rounded-full animate-spin"></div>
              ) : isDetecting ? (
                <div className="w-3 h-3 bg-red-500 rounded-sm"></div>
              ) : (
                <Camera className="w-5 h-5 text-white" />
              )}
              {isDetecting ? 'Stop Session' : 'Start Camera'}
            </button>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 h-auto lg:h-[600px]">
            
            {/* 60% Width - Camera Feed */}
            <div className={`relative w-full lg:w-[60%] h-[400px] lg:h-full rounded-3xl bg-[#0A0F1E] border-[3px] overflow-hidden transition-all duration-500 z-10 flex items-center justify-center ${glowBorderClass}`}>
              
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted
                className={`absolute inset-0 w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-300 ${!isDetecting ? 'opacity-0' : 'opacity-100'}`}
              />
              
              {/* Filter for drowsiness */}
              {isDrowsy && <div className="absolute inset-0 bg-red-500/20 mix-blend-screen pointer-events-none transition-opacity"></div>}

              {!isDetecting && (
                <div className="flex flex-col items-center gap-4 text-gray-500 z-10">
                  <div className="p-5 bg-white/5 rounded-full border border-white/10">
                    <Camera className="w-10 h-10 opacity-50" />
                  </div>
                  <span className="font-semibold tracking-wide">Click Start to Begin</span>
                </div>
              )}

              {isDetecting && (
                <>
                  <div className="absolute top-4 left-4">
                    <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 flex items-center gap-2 shadow-lg">
                      <div className={`w-2 h-2 rounded-full ${isDrowsy ? 'bg-red-500 animate-ping' : isWarning ? 'bg-amber-500' : 'bg-blue-500 animate-pulse'}`}></div>
                      <span className="text-[10px] uppercase font-bold tracking-widest text-white">LIVE</span>
                    </div>
                  </div>
                  
                  <div className="absolute top-4 right-4">
                    <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 shadow-lg">
                       <span className="text-[11px] font-mono text-gray-300">{status.fps.toFixed(1)} FPS</span>
                    </div>
                  </div>

                  <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-black/90 to-transparent flex items-end p-5">
                    <div className="flex items-center gap-3">
                      <ShieldAlert className={`w-5 h-5 ${isDrowsy ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-blue-500'}`} />
                      <span className="text-sm font-semibold text-gray-200">System Active - Monitoring Driver</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 40% Width - Stats Panels Grid */}
            <div className="w-full lg:w-[40%] flex flex-col gap-4 h-full">
              
              <div className="flex gap-4 h-48">
                {/* SVG Semicircle Gauge Card (EAR) */}
                <div className="bg-dg-card border border-white/5 rounded-3xl p-4 shadow-xl flex-[1.2] flex flex-col items-center relative overflow-hidden backdrop-blur-2xl">
                  {isDetecting && <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 bg-${stateColor.replace('#', '')}`}></div>}
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest w-full text-center mb-2">Eye Aspect Ratio</span>
                  
                  <div className="relative w-32 h-16 flex flex-col items-center justify-end">
                    <svg className="w-full h-full transform" viewBox="0 0 140 70">
                      <path d="M 15 65 A 55 55 0 0 1 125 65" className="stroke-gray-800" strokeWidth="12" fill="transparent" strokeLinecap="round" />
                      <path d="M 15 65 A 55 55 0 0 1 125 65" 
                            className={`transition-all duration-300 ease-out`} 
                            stroke={isDetecting ? (status.ear < 0.25 ? '#EF4444' : '#3B82F6') : 'transparent'}
                            strokeWidth="12" fill="transparent" strokeLinecap="round"
                            strokeDasharray={Math.PI * 55}
                            strokeDashoffset={isDetecting ? activeDashOffsetEar : Math.PI * 55} 
                      />
                      {/* Threshold marker */}
                      <line x1="70" y1="2" x2="70" y2="15" className="stroke-red-500/80" strokeWidth="3" strokeLinecap="round" transform={`rotate(${thresholdAngleEar} 70 65)`}/>
                    </svg>
                    <div className="absolute bottom-[-5px] flex flex-col items-center">
                      <span className={`text-3xl font-black tabular-nums tracking-tighter`} style={{ color: isDetecting ? (status.ear < 0.25 ? '#EF4444' : '#fff') : '#fff' }}>
                        {isDetecting ? status.ear.toFixed(3) : '0.00'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* SVG Semicircle Gauge Card (MAR) */}
                <div className="bg-dg-card border border-white/5 rounded-3xl p-4 shadow-xl flex-[1.2] flex flex-col items-center relative overflow-hidden backdrop-blur-2xl">
                  {isDetecting && <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 bg-orange-500/20`}></div>}
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest w-full text-center mb-2">Mouth Aspect Ratio</span>
                  
                  <div className="relative w-32 h-16 flex flex-col items-center justify-end">
                    <svg className="w-full h-full transform" viewBox="0 0 140 70">
                      <path d="M 15 65 A 55 55 0 0 1 125 65" className="stroke-gray-800" strokeWidth="12" fill="transparent" strokeLinecap="round" />
                      <path d="M 15 65 A 55 55 0 0 1 125 65" 
                            className={`transition-all duration-300 ease-out`} 
                            stroke={isDetecting ? (status.mar > 0.6 ? '#F97316' : '#3B82F6') : 'transparent'}
                            strokeWidth="12" fill="transparent" strokeLinecap="round"
                            strokeDasharray={Math.PI * 55}
                            strokeDashoffset={isDetecting ? activeDashOffsetMar : Math.PI * 55} 
                      />
                      {/* Threshold marker */}
                      <line x1="70" y1="2" x2="70" y2="15" className="stroke-orange-500/80" strokeWidth="3" strokeLinecap="round" transform={`rotate(${thresholdAngleMar} 70 65)`}/>
                    </svg>
                    <div className="absolute bottom-[-5px] flex flex-col items-center">
                      <span className={`text-3xl font-black tabular-nums tracking-tighter`} style={{ color: isDetecting ? (status.mar > 0.6 ? '#F97316' : '#fff') : '#fff' }}>
                        {isDetecting ? status.mar.toFixed(3) : '0.00'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Status Badge Card */}
                <div className="bg-dg-card border border-white/5 rounded-3xl p-4 shadow-xl flex-[1] flex flex-col items-center justify-center relative backdrop-blur-2xl transition-colors duration-500" style={{ backgroundColor: isDetecting && (isDrowsy || isCritical) ? 'rgba(239, 68, 68, 0.1)' : '' }}>
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(0,0,0,0.3)]" style={{ backgroundColor: `${stateColor}20`, border: `1px solid ${stateColor}40` }}>
                    {isStandby ? <Clock className="w-6 h-6 text-gray-500" /> : 
                     isWarning ? <AlertTriangle className="w-6 h-6 text-amber-500" /> : 
                     isYawning ? <span className="text-2xl">🥱</span> :
                     isDrowsy ? <Skull className="w-6 h-6 text-red-500 animate-pulse" /> : 
                     isCritical ? <Skull className="w-6 h-6 text-red-600 animate-pulse" /> :
                     <CheckCircle className="w-6 h-6 text-blue-500" />}
                  </div>
                  <span className="text-sm font-black tracking-tight" style={{ color: stateColor }}>{status.alert_state}</span>
                </div>
              </div>

              {/* Mini Stats 2x2 */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="bg-dg-card border border-white/5 rounded-2xl p-3 flex flex-col items-start backdrop-blur-xl hover:-translate-y-1 transition-transform">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-1">Time</span>
                  <span className="text-lg font-mono text-white">{formatTime(status.session_time)}</span>
                </div>
                <div className="bg-dg-card border border-white/5 rounded-2xl p-3 flex flex-col items-start backdrop-blur-xl hover:-translate-y-1 transition-transform">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-1">Avg EAR</span>
                  <span className="text-lg font-mono text-gray-300">{avgEar}</span>
                </div>
                <div className="bg-dg-card border border-white/5 rounded-2xl p-3 flex flex-col items-start backdrop-blur-xl hover:-translate-y-1 transition-transform">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-1">Drowsy</span>
                  <span className={`text-lg font-mono ${stats.drowsyEpisodes > 0 ? 'text-red-400 font-bold' : 'text-gray-300'}`}>{stats.drowsyEpisodes}</span>
                </div>
                <div className="bg-dg-card border border-white/5 rounded-2xl p-3 flex flex-col items-start backdrop-blur-xl hover:-translate-y-1 transition-transform">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-1">Yawns</span>
                  <span className={`text-lg font-mono ${stats.yawnEpisodes > 0 ? 'text-orange-400 font-bold' : 'text-gray-300'}`}>{stats.yawnEpisodes}</span>
                </div>
                <div className="bg-dg-card border border-white/5 rounded-2xl p-3 flex flex-col items-start backdrop-blur-xl hover:-translate-y-1 transition-transform col-span-2 lg:col-span-1">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-1">Sessions</span>
                  <span className="text-lg font-mono text-blue-400">{stats.totalSessions}</span>
                </div>
              </div>

              {/* Event Timeline */}
              <div className="bg-dg-card border border-white/5 rounded-3xl p-5 shadow-xl flex-1 flex flex-col backdrop-blur-2xl overflow-hidden min-h-[160px]">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Event Timeline</span>
                  <Activity className="w-4 h-4 text-gray-500" />
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                  {logs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-2 opacity-50">
                      <Clock className="w-6 h-6" />
                      <span className="text-xs font-mono">No events yet</span>
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div key={log.id} className="flex gap-3 animate-slide-in relative pl-2 border-l-2" style={{ borderLeftColor: log.type === 'error' ? '#EF4444' : log.type === 'warn' ? '#F59E0B' : '#3B82F6' }}>
                        <div className="text-[10px] font-mono text-gray-500 shrink-0 pt-0.5">{log.time}</div>
                        <div className={`text-xs ${log.type === 'error' ? 'text-red-400 font-medium' : log.type === 'warn' ? 'text-amber-400' : 'text-gray-300'}`}>
                          {log.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
          
          <div className="md:hidden mt-8 flex justify-center">
            <button 
              disabled={isModelLoading}
              onClick={() => setIsDetecting(!isDetecting)}
              className={`w-full cursor-pointer px-8 py-4 ${
                isDetecting 
                  ? 'bg-red-500/10 border border-red-500 text-red-500' 
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 border border-transparent'
              } text-white rounded-xl font-bold transition-all flex items-center justify-center gap-3`}
            >
              {isDetecting ? 'Stop Session' : 'Start Camera'}
            </button>
          </div>
        </div>
      </section>

      {/* Impact Section */}
      <section className="py-20 relative bg-[#04060E] border-y border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-12">Why Drowsy Driving Matters</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#1A0A0F] border border-red-500/20 rounded-3xl p-8 hover:-translate-y-2 transition-transform shadow-[0_10px_40px_-10px_rgba(220,38,38,0.1)]">
              <div className="text-red-500 text-5xl font-black tracking-tighter mb-4">1 in 25</div>
              <p className="text-gray-300 font-medium">Adults report having fallen asleep while driving in the past 30 days.</p>
            </div>
            <div className="bg-[#1A0A0F] border border-red-500/20 rounded-3xl p-8 hover:-translate-y-2 transition-transform shadow-[0_10px_40px_-10px_rgba(220,38,38,0.1)]">
              <div className="text-red-500 text-5xl font-black tracking-tighter mb-4">100K+</div>
              <p className="text-gray-300 font-medium">Police-reported crashes involve drowsy driving every year in the US.</p>
            </div>
            <div className="bg-[#1A0A0F] border border-red-500/20 rounded-3xl p-8 hover:-translate-y-2 transition-transform shadow-[0_10px_40px_-10px_rgba(220,38,38,0.1)]">
              <div className="text-red-500 text-5xl font-black tracking-tighter mb-4">71%</div>
              <p className="text-gray-300 font-medium">Of drowsy driving related accidents involve drivers under the age of 45.</p>
            </div>
          </div>
          <p className="text-gray-600 text-sm mt-8">Source: National Highway Traffic Safety Administration (NHTSA)</p>
        </div>
      </section>

      {/* Tech Stack Marquee */}
      <section className="py-16 border-b border-white/5 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center mb-10">
          <h2 className="text-2xl font-bold text-white">Built With Cutting-Edge Technology</h2>
        </div>
        <div className="relative w-full overflow-hidden flex">
          {/* Fading edges mask */}
          <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-dg-bg to-transparent z-10 pointer-events-none"></div>
          <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-dg-bg to-transparent z-10 pointer-events-none"></div>
          
          <div className="animate-marquee gap-6 whitespace-nowrap px-4 py-4">
            {[
              "MediaPipe Tasks Vision", "TensorFlow.js", "React 19", "Vite.js", 
              "FastAPI", "Python 3.12", "OpenCV", "Tailwind CSS v4", "WebGpu/WebGL",
              "MediaPipe Tasks Vision", "TensorFlow.js", "React 19", "Vite.js" // Duplicated for seamless loop
            ].map((tech, i) => (
              <div key={i} className="inline-flex items-center px-6 py-4 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm text-gray-300 font-bold hover:bg-white/10 hover:border-white/20 transition-all">
                {tech}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Developer Profile - Chitkara University */}
      <section id="about" className="py-24 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg h-[400px] bg-blue-600/10 rounded-full blur-[100px] z-0 pointer-events-none"></div>
        
        <div className="max-w-md mx-auto px-4 relative z-10">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-extrabold text-white">Meet the Developer</h2>
          </div>

          <div className="card-gradient-border p-8 text-center shadow-2xl relative">
            <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 mx-auto mb-6 flex items-center justify-center text-3xl font-black text-white shadow-lg border-4 border-[#0A0F1E] z-10 relative">
              MB
            </div>
            
            <h3 className="text-2xl font-black text-white mb-1">Mukund Bansal</h3>
            <p className="text-blue-400 font-bold text-sm tracking-widest uppercase mb-6">AI/ML Engineer</p>
            
            <div className="bg-black/20 rounded-xl p-5 mb-8 border border-white/5 text-sm text-gray-400 leading-relaxed font-medium">
              "Building real-world AI products that save lives. Currently pursuing B.E. CSE (AI & Future Technologies) at <span className="text-white font-bold">Chitkara University</span>."
            </div>
            
            <div className="flex justify-center gap-4">
              <a href="https://github.com/MukundBansal/drowseguard.git" className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 hover:scale-110 transition-all hover:shadow-[0_0_20px_rgba(255,255,255,0.2)] text-gray-300">
                <Github className="w-5 h-5" />
              </a>
              <a href="https://linkedin.com" className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center hover:bg-blue-600 hover:border-blue-500 hover:scale-110 transition-all hover:shadow-[0_0_20px_rgba(59,130,246,0.3)] text-blue-400 hover:text-white">
                <Linkedin className="w-5 h-5" />
              </a>
              <a href="mailto:contact@example.com" className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center hover:bg-purple-600 hover:border-purple-500 hover:scale-110 transition-all hover:shadow-[0_0_20px_rgba(168,85,247,0.3)] text-purple-400 hover:text-white">
                <Mail className="w-5 h-5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 bg-black border-t border-gradient-to-r from-transparent via-white/10 to-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-blue-500" />
            <span className="font-bold text-lg tracking-tight text-white">DrowseGuard AI</span>
          </div>
          
          <div className="text-sm font-medium text-gray-500">
            Built with ❤️ and Python by <span className="text-gray-300">Mukund Bansal</span>
          </div>
          
          <div className="text-xs text-gray-600 font-mono">
            &copy; {new Date().getFullYear()} All Rights Reserved
          </div>
        </div>
      </footer>
    </div>
  )
}

function LoginPage() {
  const navigate = useNavigate();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
      navigate('/');
    } catch (error) {
      console.error(error);
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-dg-bg flex items-center justify-center bg-grid-pattern relative overflow-hidden selection:bg-blue-500 selection:text-white">
      <div className="absolute inset-0 bg-gradient-to-b from-[#10152B]/40 to-[#0A0F1E] z-0"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[120px] mix-blend-screen animate-pulse pointer-events-none z-0"></div>

      <div className="card-gradient-border p-1 w-full max-w-md z-10 mx-4 animate-fade-up">
        <div className="bg-[#141B2D]/80 backdrop-blur-2xl rounded-[1.4rem] p-10 flex flex-col items-center text-center shadow-2xl border border-white/5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-[0_0_30px_rgba(79,70,229,0.5)] mb-6">
            <Eye className="w-8 h-8 text-white" />
          </div>
          
          <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">Welcome Back</h1>
          <p className="text-gray-400 font-medium mb-10 text-sm">Sign in to track your drowsiness history</p>
          
          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full py-4 bg-white hover:bg-gray-100 disabled:opacity-50 text-gray-900 rounded-xl font-bold flex items-center justify-center gap-3 transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl"
          >
            {isLoggingIn ? (
              <div className="w-5 h-5 border-2 border-t-transparent border-gray-900 rounded-full animate-spin"></div>
            ) : (
              <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2400/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            Continue with Google
          </button>
          
          <p className="mt-8 text-xs text-gray-500 font-semibold tracking-wide flex items-center justify-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Your data stays private and secure
          </p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  )
}

function AppRoutes() {
  const [user, setUser] = useState<User | null>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const [justLogged, setJustLogged] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser && !user) setJustLogged(true);
      setUser(currentUser)
      setLoadingAuth(false)
    })
    return unsubscribe
  }, [user])

  const handleSignOut = () => {
    signOut(auth)
  }

  if (loadingAuth) return (
    <div className="min-h-screen bg-dg-bg flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-t-transparent border-blue-500 rounded-full animate-spin"></div>
    </div>
  )

  return (
    <>
      {user && (
        <div className={`fixed bottom-10 right-10 z-50 transition-all duration-700 transform ${justLogged ? 'translate-x-0 opacity-100' : 'translate-x-20 opacity-0 pointer-events-none'}`}>
          <div className="bg-[#141B2D]/90 backdrop-blur-xl border border-white/10 text-white px-6 py-4 rounded-2xl shadow-[0_10px_40px_-10px_rgba(59,130,246,0.3)] flex items-center gap-4">
             <div className="w-10 h-10 rounded-full overflow-hidden border border-white/20">
               <img src={user.photoURL || ''} alt="G" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
             </div>
             <div className="flex flex-col">
               <span className="text-xs text-blue-400 font-bold tracking-widest uppercase">Authentication Success</span>
               <span className="font-semibold text-sm">Welcome back, {user.displayName?.split(' ')[0]}! 👋</span>
             </div>
          </div>
        </div>
      )}

      {user && justLogged && setTimeout(() => setJustLogged(false), 5000) && null}

      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
        <Route path="/" element={user ? <Dashboard user={user} handleSignOut={handleSignOut} /> : <Navigate to="/login" />} />
      </Routes>
    </>
  )
}
