import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import numpy as np
import time
import pygame
from scipy.spatial import distance as dist
import threading
import os
import wave
import struct

def generate_beep():
    # Generate a simple beep sound and save to alarm.wav if not exists
    if not os.path.exists("alarm.wav"):
        sample_rate = 44100
        duration = 1.0  # seconds
        frequency = 1000.0  # Hz
        
        n_samples = int(sample_rate * duration)
        amplitude = 32767.0
        
        with wave.open("alarm.wav", "w") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            
            for i in range(n_samples):
                value = int(amplitude * np.sin(2.0 * np.pi * frequency * i / sample_rate))
                data = struct.pack('<h', value)
                wav_file.writeframesraw(data)

class DrowsinessDetector:
    def __init__(self):
        base_options = python.BaseOptions(model_asset_path='face_landmarker.task')
        options = vision.FaceLandmarkerOptions(
            base_options=base_options,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
            num_faces=1
        )
        self.face_landmarker = vision.FaceLandmarker.create_from_options(options)
        
        # Landmark indices
        self.LEFT_EYE = [362, 385, 387, 263, 373, 380]
        self.RIGHT_EYE = [33, 160, 158, 133, 153, 144]
        
        # State variables
        self.EAR_THRESHOLD = 0.25
        self.CONSECUTIVE_FRAMES = 20
        self.frame_counter = 0
        
        # Real-time data
        self.current_ear = 0.0
        self.alert_state = "AWAKE"
        self.fps = 0.0
        self.start_time = time.time()
        self.session_time = 0.0
        
        # Audio setup
        pygame.mixer.init()
        generate_beep()
        self.beep_sound = pygame.mixer.Sound("alarm.wav")
        self.is_playing = False
        
        self.running = False
        self.thread = None
        
        # Initialize camera in main thread for macOS permission dialog
        self.cap = cv2.VideoCapture(0)

    def calculate_ear(self, eye_points, landmarks, frame_w, frame_h):
        # Extract pixel coordinates for the assigned landmarks
        points = []
        for index in eye_points:
            x = int(landmarks[index].x * frame_w)
            y = int(landmarks[index].y * frame_h)
            points.append((x, y))
            
        # compute the euclidean distances between the two sets of vertical eye landmarks
        A = dist.euclidean(points[1], points[5])
        B = dist.euclidean(points[2], points[4])

        # compute the euclidean distance between the horizontal eye landmark (inner & outer)
        C = dist.euclidean(points[0], points[3])

        # calculate EAR
        if C == 0:
            return 0.0
        ear = (A + B) / (2.0 * C)
        return ear

    def run(self):
        prev_time = time.time()
        self.running = True

        while self.running and self.cap.isOpened():
            ret, frame = self.cap.read()
            if not ret:
                break
                
            frame_h, frame_w, _ = frame.shape
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Create MediaPipe Image
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            
            # Detect using the new Tasks API
            detection_result = self.face_landmarker.detect(mp_image)
            
            curr_time = time.time()
            self.fps = 1 / (curr_time - prev_time)
            prev_time = curr_time
            self.session_time = curr_time - self.start_time

            if hasattr(detection_result, 'face_landmarks') and detection_result.face_landmarks:
                for face_landmarks in detection_result.face_landmarks:
                    left_ear = self.calculate_ear(self.LEFT_EYE, face_landmarks, frame_w, frame_h)
                    right_ear = self.calculate_ear(self.RIGHT_EYE, face_landmarks, frame_w, frame_h)
                    
                    self.current_ear = (left_ear + right_ear) / 2.0
                    
                    if self.current_ear < self.EAR_THRESHOLD:
                        self.frame_counter += 1
                        if self.frame_counter >= self.CONSECUTIVE_FRAMES:
                            self.alert_state = "DROWSY"
                            if not self.is_playing:
                                self.beep_sound.play(-1) # Play on loop
                                self.is_playing = True
                        else:
                            self.alert_state = "WARNING"
                    else:
                        self.frame_counter = 0
                        self.alert_state = "AWAKE"
                        if self.is_playing:
                            self.beep_sound.stop()
                            self.is_playing = False
            else:
                self.alert_state = "WARNING" # Couldn't detect face

        self.cap.release()
        if self.is_playing:
            self.beep_sound.stop()
            self.is_playing = False

    def start(self):
        if self.thread is None or not self.thread.is_alive():
            self.thread = threading.Thread(target=self.run, daemon=True)
            self.thread.start()

    def stop(self):
        self.running = False
        if self.thread is not None:
            self.thread.join()
