import time
import random
import threading

class DrowsinessDetector:
    def __init__(self):
        self.EAR_THRESHOLD = 0.25
        
        self.current_ear = 0.30
        self.alert_state = "AWAKE"
        self.alert_active = False
        self.fps = 29.9
        self.start_time = time.time()
        self.session_time = 0.0
        
        self.running = False
        self.thread = None

    def run(self):
        self.running = True
        
        while self.running:
            curr_time = time.time()
            self.session_time = curr_time - self.start_time
            
            # Simulate FPS around 24-30
            self.fps = random.uniform(24.0, 30.0)
            
            # Determine if we are in a drowsy episode (every 30 seconds for 5 seconds)
            cycle_time = self.session_time % 30
            
            if 25 <= cycle_time <= 30:
                # Drowsy episode (0.18 - 0.22)
                self.current_ear = random.uniform(0.18, 0.22)
            elif 23 <= cycle_time < 25:
                # Warning episode dropping gradually
                self.current_ear = random.uniform(0.23, 0.27)
            else:
                # Awake simulation
                self.current_ear = random.uniform(0.28, 0.35)
                
            # Evaluate alert state
            if self.current_ear <= self.EAR_THRESHOLD:
                if cycle_time >= 25:
                    self.alert_state = "DROWSY"
                    self.alert_active = True
                else:
                    self.alert_state = "WARNING"
                    self.alert_active = False
            else:
                self.alert_state = "AWAKE"
                self.alert_active = False
                
            # Sleep to simulate ~30fps delay natively
            time.sleep(0.033)

    def start(self):
        if self.thread is None or not self.thread.is_alive():
            self.thread = threading.Thread(target=self.run, daemon=True)
            self.thread.start()

    def stop(self):
        self.running = False
        if self.thread is not None:
            self.thread.join()
