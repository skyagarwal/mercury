#!/usr/bin/env python3
"""
Label Studio Project Setup Script
Creates ASR and TTS annotation projects with templates
"""

import requests
import json
import sys
from typing import Dict, Any

# Configuration
LABEL_STUDIO_URL = "http://192.168.0.156:8080"
API_KEY = ""  # Set this after getting from Label Studio UI

# Annotation Templates
ASR_TEMPLATE = """
<View>
  <Header value="Audio Recording" size="3"/>
  <Audio name="audio" value="$audio" hotkey="space"/>
  
  <Header value="Call Information" size="4"/>
  <View style="display: flex; gap: 20px; margin: 10px 0;">
    <Text name="call_sid" value="$call_sid" style="font-family: monospace;"/>
    <Text name="duration" value="Duration: $duration seconds"/>
    <Text name="date" value="$created_at"/>
  </View>
  
  <Header value="Original Transcript (Auto-Generated)" size="4"/>
  <View style="background: #f5f5f5; padding: 10px; border-radius: 5px; margin: 10px 0;">
    <Text name="original_text" value="$transcript"/>
    <Text name="confidence" value="Confidence: $confidence" 
          style="font-size: 12px; color: #666;"/>
  </View>
  
  <Header value="Corrected Transcript" size="4"/>
  <TextArea name="transcription" toName="audio" 
            rows="5" 
            editable="true"
            maxSubmissions="1"
            placeholder="Fix any errors in the transcript above. Preserve the language (Hindi/English/Hinglish)."/>
  
  <Header value="Audio Quality" size="4"/>
  <Choices name="quality" toName="audio" 
           choice="single-radio" 
           showInline="true"
           required="true">
    <Choice value="excellent" hint="Clear, no noise, perfect"/>
    <Choice value="good" hint="Minor background noise"/>
    <Choice value="fair" hint="Some noise, somewhat unclear"/>
    <Choice value="poor" hint="Very noisy, hard to understand"/>
    <Choice value="unusable" hint="Cannot transcribe"/>
  </Choices>
  
  <Header value="Speaker Accent/Dialect" size="4"/>
  <Choices name="accent" toName="audio" 
           choice="single-radio" 
           showInline="true">
    <Choice value="standard_hindi"/>
    <Choice value="standard_english"/>
    <Choice value="rural_hindi"/>
    <Choice value="urban_hinglish"/>
    <Choice value="regional_dialect"/>
  </Choices>
  
  <Header value="Primary Language" size="4"/>
  <Choices name="language" toName="audio" 
           choice="single-radio" 
           showInline="true"
           required="true">
    <Choice value="hindi" background="#FFE5E5"/>
    <Choice value="english" background="#E5F0FF"/>
    <Choice value="hinglish" background="#E5FFE5"/>
    <Choice value="marathi" background="#FFE5FF"/>
    <Choice value="other"/>
  </Choices>
  
  <Header value="Audio Issues (Select all that apply)" size="4"/>
  <Choices name="issues" toName="audio" 
           choice="multiple" 
           showInline="false">
    <Choice value="background_noise"/>
    <Choice value="low_volume"/>
    <Choice value="distortion"/>
    <Choice value="echo"/>
    <Choice value="interruptions"/>
    <Choice value="multiple_speakers"/>
    <Choice value="none"/>
  </Choices>
  
  <Header value="Additional Notes" size="4"/>
  <TextArea name="notes" 
            rows="2" 
            placeholder="Any additional comments about this recording (optional)"/>
</View>
"""

TTS_TEMPLATE = """
<View>
  <Header value="Synthesized Speech Sample" size="3"/>
  <Audio name="audio" value="$audio" hotkey="space"/>
  
  <Header value="Original Text" size="4"/>
  <View style="background: #f5f5f5; padding: 10px; border-radius: 5px; margin: 10px 0;">
    <Text name="text" value="$transcript"/>
    <Text name="language" value="Language: $language" 
          style="font-size: 12px; color: #666;"/>
    <Text name="provider" value="Provider: $provider" 
          style="font-size: 12px; color: #666;"/>
  </View>
  
  <Header value="Naturalness" size="4"/>
  <Text value="How natural and human-like does the voice sound?"/>
  <Rating name="naturalness" toName="audio" 
          maxRating="5" 
          icon="star" 
          size="large"
          required="true"/>
  
  <Header value="Pronunciation Accuracy" size="4"/>
  <Text value="How accurately are words pronounced?"/>
  <Rating name="pronunciation" toName="audio" 
          maxRating="5" 
          icon="star" 
          size="large"
          required="true"/>
  
  <Header value="Clarity" size="4"/>
  <Text value="How clear and easy to understand is the speech?"/>
  <Rating name="clarity" toName="audio" 
          maxRating="5" 
          icon="star" 
          size="large"
          required="true"/>
  
  <Header value="Emotional Appropriateness" size="4"/>
  <Text value="Is the emotion/tone appropriate for the text?"/>
  <Rating name="emotion" toName="audio" 
          maxRating="5" 
          icon="star" 
          size="large"
          required="true"/>
  
  <Header value="Prosody (Rhythm and Intonation)" size="4"/>
  <Text value="Does it have natural rhythm, pauses, and intonation?"/>
  <Rating name="prosody" toName="audio" 
          maxRating="5" 
          icon="star" 
          size="large"
          required="true"/>
  
  <Header value="Overall Quality" size="4"/>
  <Text value="Overall quality (MOS - Mean Opinion Score)"/>
  <Rating name="mos" toName="audio" 
          maxRating="5" 
          icon="star" 
          size="large"
          required="true"/>
  
  <Header value="Specific Issues" size="4"/>
  <Choices name="issues" toName="audio" 
           choice="multiple" 
           showInline="false">
    <Choice value="robotic_sound"/>
    <Choice value="too_fast"/>
    <Choice value="too_slow"/>
    <Choice value="wrong_pronunciation"/>
    <Choice value="muffled"/>
    <Choice value="unnatural_pauses"/>
    <Choice value="monotone"/>
    <Choice value="artifacts_glitches"/>
    <Choice value="no_issues"/>
  </Choices>
  
  <Header value="Mispronounced Words" size="4"/>
  <TextArea name="mispronounced" 
            rows="2" 
            placeholder="List any words that were mispronounced (optional)"/>
  
  <Header value="Comments" size="4"/>
  <TextArea name="comments" 
            rows="3" 
            placeholder="Any specific feedback to improve this voice model (optional)"/>
</View>
"""


def create_project(name: str, description: str, template: str) -> Dict[str, Any]:
    """Create a Label Studio project"""
    
    if not API_KEY:
        print("❌ ERROR: Please set API_KEY in the script")
        print("\nTo get your API key:")
        print("1. Login to Label Studio: http://192.168.0.156:8080")
        print("2. Go to Account & Settings")
        print("3. Copy your API Token")
        print("4. Set it in this script: API_KEY = 'your_token_here'")
        sys.exit(1)
    
    headers = {
        "Authorization": f"Token {API_KEY}",
        "Content-Type": "application/json"
    }
    
    data = {
        "title": name,
        "description": description,
        "label_config": template,
        "is_published": True,
        "maximum_annotations": 1,
        "show_annotation_history": True,
        "show_collab_predictions": False,
        "sampling": "uniform",
        "show_ground_truth_first": False,
        "show_overlap_first": False,
        "overlap_cohort_percentage": 0,
        "task_data_login": None,
        "task_data_password": None,
        "control_weights": {},
        "model_version": "",
        "color": "#FFFFFF"
    }
    
    try:
        response = requests.post(
            f"{LABEL_STUDIO_URL}/api/projects",
            headers=headers,
            json=data
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"❌ Error creating project: {e}")
        if hasattr(e.response, 'text'):
            print(f"Response: {e.response.text}")
        sys.exit(1)


def setup_cloud_storage(project_id: int, bucket: str) -> Dict[str, Any]:
    """Setup MinIO cloud storage for a project"""
    
    headers = {
        "Authorization": f"Token {API_KEY}",
        "Content-Type": "application/json"
    }
    
    # MinIO configuration
    storage_config = {
        "project": project_id,
        "title": f"MinIO - {bucket}",
        "description": f"Audio files from MinIO bucket: {bucket}",
        "storage_type": "s3",
        "bucket": bucket,
        "prefix": "",
        "regex_filter": ".*\\.(wav|mp3|ogg|flac)$",
        "use_blob_urls": True,
        "presign": True,
        "presign_ttl": 3600,
        "recursive_scan": True,
        "s3_endpoint": "http://192.168.0.156:9002",
        "aws_access_key_id": "admin",
        "aws_secret_access_key": "minio_strong_password",
        "region_name": "us-east-1"
    }
    
    try:
        response = requests.post(
            f"{LABEL_STUDIO_URL}/api/storages/s3",
            headers=headers,
            json=storage_config
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"⚠️  Warning: Could not setup cloud storage: {e}")
        return {}


def main():
    print("=" * 70)
    print("🎯 LABEL STUDIO PROJECT SETUP")
    print("=" * 70)
    print()
    
    # Check if Label Studio is accessible
    try:
        response = requests.get(f"{LABEL_STUDIO_URL}/api/version", timeout=5)
        response.raise_for_status()
        print(f"✅ Label Studio is accessible: {LABEL_STUDIO_URL}")
        version = response.json()
        print(f"   Version: {version.get('release', 'unknown')}")
    except Exception as e:
        print(f"❌ Cannot connect to Label Studio: {e}")
        print(f"\nMake sure Label Studio is running:")
        print(f"  docker ps | grep labelstudio")
        sys.exit(1)
    
    print()
    
    # Create ASR project
    print("📝 Creating ASR Transcription Project...")
    asr_project = create_project(
        name="ASR Transcription Review",
        description="Review and correct automatic speech recognition transcripts from call recordings",
        template=ASR_TEMPLATE
    )
    print(f"✅ ASR Project Created")
    print(f"   ID: {asr_project['id']}")
    print(f"   URL: {LABEL_STUDIO_URL}/projects/{asr_project['id']}")
    print()
    
    # Setup MinIO storage for ASR
    print("☁️  Connecting MinIO storage (call-recordings)...")
    asr_storage = setup_cloud_storage(asr_project['id'], "call-recordings")
    if asr_storage:
        print(f"✅ Storage connected")
    print()
    
    # Create TTS project
    print("🎙️  Creating TTS Quality Rating Project...")
    tts_project = create_project(
        name="TTS Quality Rating",
        description="Rate quality of synthesized speech samples (MOS scores)",
        template=TTS_TEMPLATE
    )
    print(f"✅ TTS Project Created")
    print(f"   ID: {tts_project['id']}")
    print(f"   URL: {LABEL_STUDIO_URL}/projects/{tts_project['id']}")
    print()
    
    # Setup MinIO storage for TTS
    print("☁️  Connecting MinIO storage (training-data)...")
    tts_storage = setup_cloud_storage(tts_project['id'], "training-data")
    if tts_storage:
        print(f"✅ Storage connected")
    print()
    
    # Save project IDs to config file
    config = {
        "label_studio_url": LABEL_STUDIO_URL,
        "asr_project_id": asr_project['id'],
        "tts_project_id": tts_project['id'],
        "created_at": "2025-12-19"
    }
    
    config_path = "/home/ubuntu/mangwale-voice/config/label_studio_config.json"
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)
    
    print("=" * 70)
    print("✅ SETUP COMPLETE!")
    print("=" * 70)
    print()
    print(f"📋 ASR Project: {LABEL_STUDIO_URL}/projects/{asr_project['id']}")
    print(f"🎙️  TTS Project: {LABEL_STUDIO_URL}/projects/{tts_project['id']}")
    print()
    print(f"⚙️  Configuration saved: {config_path}")
    print()
    print("📝 NEXT STEPS:")
    print("1. Login to Label Studio and review projects")
    print("2. Invite annotators: Settings → Members")
    print("3. Update exotel_webhook_handler.py with project IDs")
    print("4. Deploy webhook handler service")
    print("5. Configure Exotel webhook URL")
    print()


if __name__ == "__main__":
    main()
