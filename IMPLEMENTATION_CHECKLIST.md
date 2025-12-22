# 🎯 MANGWALE VOICE - IMPLEMENTATION CHECKLIST

**Implementation Start**: December 19, 2025  
**Target Completion**: January 23, 2026 (5 weeks)  
**Status**: Ready to Deploy

---

## ✅ PHASE 1: FOUNDATION (Week 1 - Dec 19-26)

### 1.1 Label Studio Deployment
- [ ] **SSH to Jupiter server**
  ```bash
  ssh jupiter@192.168.0.156
  cd /path/to/mangwale-voice
  ```

- [ ] **Deploy Label Studio**
  ```bash
  ./deploy-label-studio.sh
  ```
  - Creates directories: `/data/label-studio`, `/data/label-studio/media`
  - Starts Label Studio on port 8080
  - Starts PostgreSQL on port 5433
  - Links MinIO storage for audio access

- [ ] **Initial Setup**
  - Login: http://192.168.0.156:8080
  - Credentials: admin@mangwale.ai / mangwale_admin_2025
  - Create workspace: "Mangwale Voice Training"

- [ ] **Create Projects**
  
  **Project 1: ASR Transcription Review**
  ```xml
  <View>
    <Audio name="audio" value="$audio"/>
    <Header value="Original Transcript:"/>
    <Text name="original" value="$text"/>
    <Header value="Corrected Transcript:"/>
    <TextArea name="transcription" toName="audio" 
              rows="5" editable="true" 
              placeholder="Fix any errors in the transcript"/>
    
    <Choices name="quality" toName="audio" 
             choice="single" showInline="true">
      <Choice value="excellent" hint="Clear, no noise"/>
      <Choice value="good" hint="Minor issues"/>
      <Choice value="fair" hint="Some noise/unclear"/>
      <Choice value="poor" hint="Very noisy/unusable"/>
    </Choices>
    
    <Choices name="accent" toName="audio" 
             choice="single" showInline="true">
      <Choice value="standard"/>
      <Choice value="rural"/>
      <Choice value="urban"/>
      <Choice value="code-mixed"/>
    </Choices>
    
    <Choices name="language" toName="audio" 
             choice="single" showInline="true">
      <Choice value="hindi"/>
      <Choice value="english"/>
      <Choice value="hinglish"/>
      <Choice value="marathi"/>
    </Choices>
  </View>
  ```

  **Project 2: TTS Quality Rating**
  ```xml
  <View>
    <Audio name="audio" value="$audio"/>
    <Text name="text" value="$transcript"/>
    
    <Rating name="naturalness" toName="audio" 
            maxRating="5" icon="star" size="large"/>
    <Text value="How natural does the voice sound?"/>
    
    <Rating name="pronunciation" toName="audio" 
            maxRating="5" icon="star" size="large"/>
    <Text value="How accurate is pronunciation?"/>
    
    <Rating name="emotion" toName="audio" 
            maxRating="5" icon="star" size="large"/>
    <Text value="How appropriate is the emotion?"/>
    
    <Choices name="issues" toName="audio" 
             choice="multiple" showInline="false">
      <Choice value="robotic"/>
      <Choice value="too_fast"/>
      <Choice value="too_slow"/>
      <Choice value="wrong_pronunciation"/>
      <Choice value="muffled"/>
      <Choice value="no_issues"/>
    </Choices>
  </View>
  ```

- [ ] **Test with Sample Data**
  - Upload 5-10 sample audio files
  - Complete annotations
  - Verify export works

### 1.2 Exotel Webhook Integration

- [ ] **Deploy Webhook Service**
  ```bash
  cd /home/ubuntu/mangwale-voice/escotel-stack/exotel-service
  
  # Install dependencies
  pip install asyncpg soundfile minio
  
  # Run webhook handler
  python exotel_webhook_handler.py
  ```
  - Service runs on port 3150
  - Handles: `/webhook/exotel/recording`
  - Health check: http://192.168.0.151:3150/health

- [ ] **Configure Exotel Dashboard**
  1. Login to: https://my.exotel.com
  2. Navigate to: Settings → Webhooks
  3. Add Recording Webhook:
     - URL: `https://mercury.mangwale.ai/webhook/exotel/recording`
     - Method: POST
     - Events: `recording.completed`

- [ ] **Test Recording Flow**
  ```bash
  # Make test call
  curl -X POST https://api.exotel.com/v1/Accounts/{SID}/Calls/connect \
    -u {API_KEY}:{API_TOKEN} \
    -d "From={YOUR_PHONE}" \
    -d "To={VENDOR_PHONE}" \
    -d "CallerId={EXOTEL_NUMBER}" \
    -d "Record=true" \
    -d "RecordingStatusCallback=https://mercury.mangwale.ai/webhook/exotel/recording"
  
  # Verify webhook received
  curl http://192.168.0.151:3150/recordings/{CALL_SID}
  ```

- [ ] **Verify Pipeline**
  - [ ] Recording downloads from Exotel
  - [ ] Audio uploads to MinIO
  - [ ] Transcription completes
  - [ ] Label Studio task created
  - [ ] Database entry saved

### 1.3 Database Setup

- [ ] **Create Tables** (on Jupiter PostgreSQL)
  ```sql
  -- SSH to Jupiter
  ssh -i ~/.ssh/jupiter_key jupiter@192.168.0.156
  
  -- Connect to database
  psql -U headless headless_mangwale
  
  -- Create call_recordings table
  CREATE TABLE IF NOT EXISTS call_recordings (
      id SERIAL PRIMARY KEY,
      call_sid VARCHAR(255) UNIQUE NOT NULL,
      recording_url TEXT,
      minio_url TEXT NOT NULL,
      duration INTEGER,
      from_number VARCHAR(50),
      to_number VARCHAR(50),
      transcript TEXT,
      language VARCHAR(10),
      confidence FLOAT,
      quality_score FLOAT,
      label_studio_task_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP,
      annotation_completed BOOLEAN DEFAULT FALSE,
      training_dataset_exported BOOLEAN DEFAULT FALSE
  );
  
  CREATE INDEX idx_call_recordings_call_sid ON call_recordings(call_sid);
  CREATE INDEX idx_call_recordings_quality ON call_recordings(quality_score);
  CREATE INDEX idx_call_recordings_created_at ON call_recordings(created_at);
  
  -- Grant permissions
  GRANT ALL ON call_recordings TO headless;
  GRANT ALL ON call_recordings_id_seq TO headless;
  ```

---

## ✅ PHASE 2: AUTOMATION (Week 2 - Dec 26-Jan 2)

### 2.1 Auto-Transcription Service

- [ ] **Create Transcription Worker**
  ```bash
  cd /home/ubuntu/mangwale-voice/escotel-stack/exotel-service
  nano transcription_worker.py
  ```

- [ ] **Key Features**
  - Monitors MinIO for new recordings
  - Auto-transcribes with Faster-Whisper
  - Calculates quality scores
  - Creates Label Studio tasks
  - Updates database

- [ ] **Deploy as systemd Service**
  ```bash
  sudo nano /etc/systemd/system/transcription-worker.service
  
  [Unit]
  Description=Mangwale Transcription Worker
  After=network.target
  
  [Service]
  Type=simple
  User=ubuntu
  WorkingDirectory=/home/ubuntu/mangwale-voice/escotel-stack/exotel-service
  ExecStart=/usr/bin/python3 transcription_worker.py
  Restart=always
  
  [Install]
  WantedBy=multi-user.target
  
  # Enable and start
  sudo systemctl enable transcription-worker
  sudo systemctl start transcription-worker
  sudo systemctl status transcription-worker
  ```

### 2.2 Quality Monitoring Dashboard

- [ ] **Create Monitoring Script**
  - Daily email report
  - Metrics: recordings processed, quality distribution, annotation progress
  - Alerts: low quality recordings, webhook failures, disk space

- [ ] **Setup Cron Job**
  ```bash
  crontab -e
  
  # Daily report at 9 AM
  0 9 * * * /usr/bin/python3 /home/ubuntu/mangwale-voice/scripts/daily_report.py
  
  # Hourly health check
  0 * * * * /usr/bin/python3 /home/ubuntu/mangwale-voice/scripts/health_check.py
  ```

### 2.3 Annotation Workflow

- [ ] **Assign Annotators**
  - Create Label Studio accounts
  - Set permissions (annotator vs reviewer)
  - Assign projects

- [ ] **Define Guidelines**
  - Create annotation manual
  - Example annotations
  - Quality standards
  - Edge cases

- [ ] **Training Session**
  - Train annotators on 50 samples
  - Check inter-annotator agreement
  - Refine guidelines

---

## ✅ PHASE 3: TRAINING PIPELINE (Week 3-4 - Jan 2-16)

### 3.1 Dataset Export

- [ ] **Create Export Script**
  ```bash
  cd /home/ubuntu/mangwale-voice/scripts
  nano export_training_data.py
  ```

- [ ] **Export Annotated Data**
  ```bash
  # Export ASR training data
  python export_training_data.py \
    --project-id 1 \
    --output-dir /data/training/asr-hindi-v1 \
    --min-quality 0.8 \
    --format huggingface
  
  # Creates HuggingFace dataset:
  # - audio/ (WAV files)
  # - metadata.jsonl (transcripts + metadata)
  # - dataset_info.json
  ```

- [ ] **Upload to HuggingFace Hub** (optional)
  ```bash
  huggingface-cli login
  python push_dataset.py \
    --dataset-dir /data/training/asr-hindi-v1 \
    --repo mangwale/voice-hindi-v1 \
    --private
  ```

### 3.2 ASR Fine-tuning

- [ ] **Setup Training Environment**
  ```bash
  # On Mercury (GPU server)
  cd /home/ubuntu/mangwale-voice/training
  
  # Install dependencies
  pip install transformers datasets accelerate evaluate jiwer
  ```

- [ ] **Fine-tune Whisper**
  ```bash
  python finetune_whisper.py \
    --base-model openai/whisper-large-v3-turbo \
    --dataset /data/training/asr-hindi-v1 \
    --output-dir ./whisper-mangwale-hi-v1 \
    --num-epochs 10 \
    --batch-size 4 \
    --learning-rate 1e-5
  ```

- [ ] **Evaluate Model**
  ```bash
  python evaluate_asr.py \
    --model ./whisper-mangwale-hi-v1 \
    --test-set /data/training/asr-hindi-v1-test \
    --output metrics.json
  
  # Expected improvements:
  # Baseline WER: 18-20%
  # Target WER: <15%
  ```

### 3.3 TTS Fine-tuning

- [ ] **Export TTS Training Data**
  ```bash
  python export_tts_data.py \
    --bucket training-data \
    --prefix tts/ \
    --min-rating 4.0 \
    --output-dir /data/training/tts-hindi-v1
  ```

- [ ] **Fine-tune Indic-Parler**
  ```bash
  python finetune_indic_parler.py \
    --base-model ai4bharat/indic-parler-tts \
    --dataset /data/training/tts-hindi-v1 \
    --output-dir ./indic-parler-mangwale-v1 \
    --num-epochs 20
  ```

- [ ] **Test TTS Quality**
  ```bash
  python test_tts.py \
    --model ./indic-parler-mangwale-v1 \
    --test-sentences test_sentences.txt \
    --output-dir ./tts-samples
  
  # Manual listening test
  # Calculate MOS (Mean Opinion Score)
  ```

### 3.4 Model Registry

- [ ] **Create Model Registry**
  ```bash
  mkdir -p /data/models/{asr,tts}
  
  # Version structure:
  # /data/models/asr/v1.0/ (baseline - Whisper large-v3)
  # /data/models/asr/v1.1/ (mangwale-finetuned)
  # /data/models/tts/v1.0/ (baseline - Indic-Parler)
  # /data/models/tts/v1.1/ (mangwale-finetuned)
  ```

- [ ] **Deploy Models**
  ```bash
  # Copy to model directory
  cp -r ./whisper-mangwale-hi-v1 /data/models/asr/v1.1/
  cp -r ./indic-parler-mangwale-v1 /data/models/tts/v1.1/
  
  # Update service configs to use new models
  ```

---

## ✅ PHASE 4: PRODUCTION DEPLOYMENT (Week 5 - Jan 16-23)

### 4.1 A/B Testing Framework

- [ ] **Implement A/B Testing**
  ```python
  # In ASR/TTS services
  def get_model_version(call_id: str) -> str:
      if hash(call_id) % 2 == 0:
          return 'v1.0'  # Baseline
      else:
          return 'v1.1'  # Fine-tuned
  ```

- [ ] **Track Metrics**
  ```sql
  CREATE TABLE ab_test_results (
      id SERIAL PRIMARY KEY,
      call_id VARCHAR(255),
      model_version VARCHAR(10),
      model_type VARCHAR(10),  -- 'asr' or 'tts'
      wer FLOAT,  -- For ASR
      mos FLOAT,  -- For TTS
      latency_ms INT,
      user_satisfaction INT,  -- 1-5 rating
      created_at TIMESTAMP DEFAULT NOW()
  );
  ```

- [ ] **Analysis Dashboard**
  - Compare WER: v1.0 vs v1.1
  - Compare latency
  - Statistical significance test
  - User feedback

### 4.2 Automated Retraining

- [ ] **Create Retraining Pipeline**
  ```bash
  nano /home/ubuntu/mangwale-voice/scripts/auto_retrain.py
  ```

- [ ] **Schedule Weekly Checks**
  ```bash
  crontab -e
  
  # Every Sunday at 2 AM
  0 2 * * 0 /usr/bin/python3 /home/ubuntu/mangwale-voice/scripts/auto_retrain.py
  ```

- [ ] **Retraining Logic**
  ```python
  # Pseudocode
  new_samples = count_annotations_since_last_train()
  
  if new_samples >= 1000:
      # Export new dataset
      dataset = export_annotated_dataset()
      
      # Fine-tune
      new_model = finetune(dataset)
      
      # Evaluate
      metrics = evaluate(new_model)
      
      # Deploy if better
      if metrics.wer < current_wer:
          deploy_model(new_model, 'v1.2')
          start_ab_test('v1.1', 'v1.2')
      else:
          send_alert("New model performs worse")
  ```

### 4.3 Monitoring & Alerts

- [ ] **Setup Prometheus + Grafana**
  - Track: recordings/day, quality distribution, annotation throughput
  - Dashboards: Training pipeline, Model performance, System health

- [ ] **Configure Alerts**
  - Webhook failures
  - Low disk space
  - Model performance degradation
  - Annotation backlog > 500

### 4.4 Documentation

- [ ] **Create User Guides**
  - [ ] Annotator handbook
  - [ ] Admin dashboard guide
  - [ ] API documentation
  - [ ] Troubleshooting guide

- [ ] **Technical Documentation**
  - [ ] Architecture diagrams
  - [ ] Database schema
  - [ ] API endpoints
  - [ ] Deployment procedures

---

## 🎯 SUCCESS CRITERIA

### Week 1 Milestones:
- [ ] Label Studio operational
- [ ] First 10 recordings annotated
- [ ] Exotel webhook connected
- [ ] Database tables created

### Week 2 Milestones:
- [ ] 50+ recordings processed
- [ ] Auto-transcription working
- [ ] Quality monitoring active
- [ ] Annotators trained

### Week 3-4 Milestones:
- [ ] 100+ hours of training data
- [ ] First fine-tuned models
- [ ] WER improvement measured
- [ ] Models deployed to staging

### Week 5 Milestones:
- [ ] A/B testing live
- [ ] Automated retraining scheduled
- [ ] Monitoring dashboards live
- [ ] Production deployment complete

---

## 📊 KEY METRICS TO TRACK

### Data Collection:
- [ ] Recordings processed per day
- [ ] Audio quality distribution
- [ ] Annotation throughput
- [ ] Storage usage

### Model Performance:
- [ ] ASR Word Error Rate (WER)
- [ ] TTS Mean Opinion Score (MOS)
- [ ] Latency (ASR/TTS)
- [ ] System uptime

### Business Impact:
- [ ] Call success rate
- [ ] User satisfaction
- [ ] Automation rate
- [ ] Support tickets

---

## ⚠️ CRITICAL DEPENDENCIES

### Before Starting:
1. ✅ MinIO storage operational (192.168.0.156:9002)
2. ✅ Faster-Whisper ASR running (192.168.0.151:7001)
3. ✅ PostgreSQL accessible (192.168.0.156:5432)
4. ⚠️ Exotel API credentials configured
5. ⚠️ Label Studio API key obtained
6. ⚠️ Disk space: 500GB+ available on Jupiter

### API Keys Needed:
```bash
# Add to .env file
EXOTEL_SID=your_sid
EXOTEL_API_KEY=your_key
EXOTEL_API_TOKEN=your_token
LABEL_STUDIO_API_KEY=your_label_studio_key
```

---

## 🚨 RISK MITIGATION

### Potential Issues:
1. **Storage Full**: Monitor disk usage, auto-cleanup old recordings
2. **Webhook Failures**: Retry mechanism, dead letter queue
3. **Poor Quality Data**: Strict quality thresholds, manual review
4. **Model Regression**: A/B testing, rollback procedures
5. **Annotation Backlog**: Priority queue, scale annotators

### Backup Strategy:
- Daily database backups
- Weekly model snapshots
- Monthly full system backup

---

## 📞 SUPPORT CONTACTS

### Technical Issues:
- Mercury Server: ubuntu@192.168.0.151
- Jupiter Server: jupiter@192.168.0.156
- Exotel Support: support@exotel.com
- Label Studio Docs: https://labelstud.io/guide

### Escalation Path:
1. Check logs: `docker-compose logs -f [service]`
2. Review health: `/health` endpoints
3. Database check: `psql -U headless headless_mangwale`
4. System resources: `htop`, `df -h`, `nvidia-smi`

---

**Next Step**: Deploy Label Studio on Jupiter  
**Command**: `./deploy-label-studio.sh`  
**ETA**: 10-15 minutes

**Status**: ✅ Ready to Begin
