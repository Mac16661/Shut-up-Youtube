import os
import boto3
import urllib.request
from pymongo import MongoClient, UpdateOne
from googleapiclient.discovery import build
from groq import Groq
import json
from pydantic import BaseModel, Field, field_validator
from typing import List
from datetime import datetime
import uuid
from dotenv import load_dotenv
load_dotenv()
from pathlib import Path
import threading


MONGO_URL = os.getenv("MONGODB")
DB_NAME = os.getenv("DB_NAME")
YT_API_KEY = os.getenv("YOUTUBE_API_KEY")
GQ_API_KEY = os.getenv("GROQ_API")

# Initialize Groq client
groq_client = Groq(api_key=GQ_API_KEY)

youtube = build('youtube', 'v3', developerKey=YT_API_KEY)

# Pick a folder where you want the file
folder = Path("./data")   # creates ./data if not exists
folder.mkdir(parents=True, exist_ok=True)

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

# TODO: Update this function to get more context about the channel, call youtube api with additional param to get channel tittle description etc
def get_yt_playlist_id(identifier, search_by='id'):
    """Get uploads playlist ID by channel ID, handle, or username"""

    try:
        if search_by == 'handle':
            # Clean the handle (remove /@ prefixes)
            clean_handle = identifier.replace('/@', '').replace('@', '')

            request = youtube.channels().list(
                part='snippet,statistics,contentDetails,brandingSettings',
                forHandle=clean_handle
            )
        elif search_by == 'username':
            request = youtube.channels().list(
                part='snippet,statistics,contentDetails,brandingSettings',
                forUsername=identifier
            )
        else:  # search_by == 'id'
            clean_id = identifier.replace('/', '')
            request = youtube.channels().list(
                part='snippet,statistics,contentDetails,brandingSettings',
                id=clean_id
            )

        response = request.execute()

        # if response['items']:
        #     uploads_playlist_id = response['items'][0]['contentDetails']['relatedPlaylists']['uploads']
        #     return uploads_playlist_id
        # return None

        if not response['items']:
            return None

        channel = response['items'][0]
        snippet = channel['snippet']
        stats = channel['statistics']

        info = {
            'channel_id': channel['id'],
            'title': snippet.get('title'),
            'description': snippet.get('description'),
            'published_at': snippet.get('publishedAt'),
            'country': snippet.get('country'),
            'thumbnails': snippet.get('thumbnails', {}),
            'view_count': stats.get('viewCount'),
            'subscriber_count': stats.get('subscriberCount'),
            'video_count': stats.get('videoCount'),
            'uploads_playlist_id': channel['contentDetails']['relatedPlaylists']['uploads']
        }

        return info
    except Exception as e:
        print("ERR OCCURRED IN:: get_yt_playlist_id function while fetching channel data -> ", e)
        return  None

def get_videos_from_playlist(playlist_id):
    """Get 10 videos from a specific playlist"""
    try:
        request = youtube.playlistItems().list(
            part='snippet',
            playlistId=playlist_id,
            maxResults=50
        )
        response = request.execute()

        videos = []
        for item in response.get('items', []):
            video_data = {
                'video_id': item['snippet']['resourceId']['videoId'],
                'title': item['snippet']['title'],
                'description': item['snippet']['description'] if item['snippet']['description'] else '',
                'published_at': item['snippet']['publishedAt'],
                'thumbnail': item['snippet']['thumbnails']['medium']['url'],
                'channel_title': item['snippet']['channelTitle']
            }
            videos.append(video_data)

        return videos

    except Exception as e:
        print(f"ERR OCCURRED IN:: get_videos_from_playlist function while fetching playlist information {playlist_id}: {e}")
        return []

def write_to_batch_file(channel_name, channel_desc, uploaded_videos, file_path, unique_id) :
    # Manual schema with proper additionalProperties
    response_schema = {
        "type": "object",
        "properties": {
            "channel_name": {
                "type": "string"
            },
            "categories": {
                "type": "array",
                "items": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9
                },
                "minItems": 1,
                "maxItems": 3,
                "uniqueItems": True
            }
        },
        "required": ["channel_name", "categories"],
        "additionalProperties": False
    }

    system_prompt = """You are a YouTube channel categorizer. Analyze the channel name and video content to determine which categories the channel belongs to.

    Categories (use integers 0-6):
    0: IT & Computer Science (AI, CS, IT, Data Science, Cybersecurity, Game development etc)
    1: Core Engineering & Robotics (Mechanical, Electrical, Mechatronics, Robotics, Aeronautics, Chemical, Electronics & Communication, Instrumentation, Industrial & Production, Aerospace, Automobile, Metallurgical & Materials, Environmental, Mining,Marine & Ocean, Petroleum ,Biomedical, Nuclear, Structural , Agricultural, Textile etc)
    2: Medicine, Health & Life Sciences	(Medicine, Biotech, Biomedical, Nursing, Biotechnology, Genetics, Zoology, Botany, Biochemistry, Environmental Science, Pharmacy,  Marine Biology, Medical Laboratory Technology,Bachelor of Medicine, Bachelor of Surgery, Bachelor of Ayurvedic Medicine & Surger, Bachelor of Homeopathic Medicine & Surgery, Bachelor of Physiotherapy, Biological Sciences   etc)
    3: Business, Finance & Economics	(MBA, Fintech, Management, Finance, Chartered Accountant, Economics, Commerce, Foreign Trade Management, Banking, Marketing,  Supply Chain Management  etc)
    4: Arts & Humanities  (Literature, Philosophy, Geography, Economics, Political Science, Humanities, History, Languages & Linguistics,Religious Studies, Sociology, Psychology, Anthropology, Archaeology, Arts & Fine Arts, Music & Performing Arts, Theater & Drama, Design & Visual Communication , Media & Communication, Cultural Studies, Education & Pedagogy, Public Administration & Policy, Interdisciplinary Arts, Fashion & Textile Design, Game Design & Animation , Digital Media Arts, Creative Writing & Literature, Cultural Heritage and Preservation, Environmental and Ecological Arts, Heritage & Museum Studies  etc)
    5: Competitive Exams (Gaokao, IIT JEE Advanced, UPSC Civil Services Exam (CSE), GRE, CFA (Chartered Financial Analyst), USMLE (United States Medical Licensing Exam), CA Exam (ICAI, ICMAI), Mensa IQ Test, CAT (Common Admission Test), CLAT (Common Law Admission Test), LSAT, NEET (National Eligibility cum Entrance Test), AIIMS MBBS Entrance, SSC CGL (Combined Graduate Level), IBPS PO, SBI PO, GATE (Graduate Aptitude Test in Engineering), TOEFL / IELTS, Defence Exams (NDA, CDS, AFCAT), ESA (Engineering Services Examination), National Talent Search Exam, International Science Olympiads  etc)
    6: High School/ Pre-university (English, Hindi, Maths, Science, Social Science, Economics, Geography, History etc)
    7: Others

    Choose relevant categories based on the video content."""

    # print(f"Channel name: {channel_name}\nChannel description: {channel_desc} \nVideos:\n{uploaded_videos}")

    batch_request = {
        "custom_id": str(uuid.uuid4()),  # Unique ID
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Channel name: {channel_name}\nChannel description: {channel_desc} \nVideos:\n{uploaded_videos}"}
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "channel_category_analysis",
                    "schema": response_schema
                }
            },
            "temperature": 0
        }
    }

    try:
        with open(file_path, "a", encoding="utf-8") as file:
            file.write(json.dumps(batch_request, ensure_ascii=False) + "\n")
        
        print(f"Added batch request for channel: {channel_name}")
    except (FileNotFoundError, json.JSONDecodeError):
       print("ERR OCCURRED IN:: write_to_batch_file function -> File dose not exist/incorrect json -> ", e)
    except Exception as e:
        print("ERR OCCURRED IN:: write_to_batch_file function -> ", e)    

def submit_task(file_path):
    """upload batch file to groq and submit the file id return both groq file_path and batch_id"""

    try:
        file_upload_response  = groq_client.files.create(file=open(file_path, "rb"), purpose="batch")
    except Exception as e:
        print("ERR OCCURRED IN:: submit_task function while uploading batch file to groq cloud-> ", e)
        return None, None

    print("Uploaded file disc:: ", file_upload_response)
  
    try:
        submit_run_response = groq_client.batches.create(
            completion_window="24h",
            endpoint="/v1/chat/completions",
            input_file_id=file_upload_response.id,
        )

        return file_upload_response.id, submit_run_response.id
    except Exception as e:
        print("ERR OCCURRED IN:: submit_task function while calling chat completion api using batch file -> ", e)
        return None, None

def execute_new_jobs():
    """
    Fetch fifty channels which have status==0, calls youtube api to get playlist id using handle_name, 
    then create a batch file for groq cloud llama 4 llm and update the status to 1 if successful.
    """
    print("Inside execute new jobs")

    batch_collection = db['batches']
    collection = db["channels"]
    BATCH_SIZE = 50  # TODO: Increase batch size to 50

    # Use a cursor to stream through results in batches
    try:
        cursor = collection.find({"status": 0}).batch_size(BATCH_SIZE)  # Might need its own exceptional handling
    except Exception as e:
        print("ERR OCCURRED IN:: execute_new_job function while acquiring cursor from MongoDB for batch insert")
        return 
    
    while True:
        batch = []
        try:
            for _ in range(BATCH_SIZE):
                record = next(cursor)
                batch.append(record)
                print(record)

        except StopIteration:
            # Fewer remaining docs than batch size - this is handled correctly
            pass

        if not batch:
            break

        # Process this batch
        print(f"Processing batch of length {len(batch)}")
        
        # Add your YouTube API calls and Groq processing here
        processed_successfully = []
        unique_id = uuid.uuid4()         
        file_name = f"{unique_id}.jsonl" 
        file_path = folder / file_name
        with open(file_path, "x"):
            pass   # file is created, nothing written
        
        
        for channel in batch:
            print(channel["channel_name"], channel["status"])
            channel_info = {}

            if "@" in channel["channel_handle"][:2]:
                channel_info = get_yt_playlist_id(channel["channel_handle"], search_by='handle') # handle will have @ 
            else :
                channel_info = get_yt_playlist_id(channel["channel_handle"], search_by='id') # id's wont have @ in it

            # If there is no channel info (may occur due to invalid channel name or handle)
            if channel_info == None:
                continue

            playlist_id = channel_info['uploads_playlist_id']
            ids = [playlist_id]
            videos = get_videos_from_playlist(ids[0])

            # If there are not videos to process or err occurred in get_videos_from_playlist function
            if len(videos) == 0: 
                continue

            channel_name = channel["channel_name"]
            channel_desc = channel_info["description"]
 
            video_lines = [
                f"{i}. video title: {video['title']}"
                for i, video in enumerate(videos, 1)
            ]
            uploaded_videos =  "\n".join(video_lines)
            uploaded_videos = uploaded_videos[:6000]    # After removing the description uploaded videos might not cross 6000 length so do the changes accordingly so it dose not give any error

            write_to_batch_file(channel_name, channel_desc, uploaded_videos, file_path, unique_id)

            # For now, assuming all process successfully:
            channel["videos"] = videos
            processed_successfully.append(channel)

        groq_file_path, batch_id = submit_task(file_path) 

        if groq_file_path == None or batch_id == None:
            print("ERR OCCURRED IN:: execute_new_job function while calling submit_task fn, it returned None in groq_file_path or batch_id -> ", e)
            return


        # push groq_file_path and batch_id into the batch schema
        batch_doc = {
            'file_id': groq_file_path,
            'batch_id': batch_id,
            'status': 0,
            'timestamp': datetime.now().timestamp()
        }

        try:
            result = batch_collection.insert_one(batch_doc)
            print(f"Successfully inserted batch with batch id: {batch_doc['batch_id']} file id {batch_doc['file_id']}")
        except Exception as e:
            print(f"ERR OCCURRED IN:: execute_new_job function while inserting batch entry in MongoDB -> {e}")
    
        # print("===", len(processed_successfully))
        # Bulk update status to 1 for all successfully processed channels (deserves its own function)

        try:
            if processed_successfully:
                update_operations = [
                    UpdateOne(
                        {
                            "channel_name": channel["channel_name"],
                            "channel_handle": channel["channel_handle"],
                        },
                        {
                            "$set": {"status": 1},
                            "$push": {"videos": {"$each": channel["videos"]}}   # just update here to insert videos
                        }
                    ) 
                    for channel in processed_successfully
                ]
                
                result = collection.bulk_write(update_operations)
                print(f"Updated status for {result.modified_count} documents in this batch")
        except Exception as e:
            print("ERR OCCURRED IN:: execute_new_job function while inserting processed channel data to MongoDB -> ", e)
            return
    

    print("All batches processed successfully!")
    return

def update_running_jobs():
    """
        Fetch from batch one at a time check the status of batch file if failed re-run, if running skip it and if completed download the result from groq cloud and update the status to 2.
        Calls update channel database function
    """

    try:
        collection = db["batches"] 
        docs = list(collection.find({"status": 0}))  # TODO: It might load too many records at once
    except Exception as e:
        print("ERR OCCURRED IN:: update_running_jobs function while fetching all the unprocessed batches -> ", e)
        return

    for doc in docs:
        # check if batch is finished running , if not continue

        try:
            response = groq_client.batches.retrieve(doc["batch_id"])
            response = json.loads(response.to_json())
            # print(response)
        except Exception as e:
            print("ERR OCCURRED IN:: update_running_jobs function while retrieve batch file form groq -> ", e)
            continue

        # if yes call update_channel_database function(batch_id) to get the result and update channel database
        if response["status"] == "completed" and response["output_file_id"] != None:
            print(f"COMPLETED BATCH ID: {response['id']}")
            update_channel_database(response["output_file_id"], response['id'])
        elif response["status"] == "failed" or response["status"]== "expired":
            # TODO: re-submit the batch using the same batch file
            print(f"ERR IN BATCH ID: {response['id']}")
            continue
        else:
            print(f"BATH ID: {response['status']}")
            continue

        # if above operation is successful then update batch status to 1

        try:
            result = collection.update_one(
                {'batch_id': doc["batch_id"]},
                {"$set": {"status": 1}}
            )
        except Exception as e:
            print("ERR OCCURRED IN:: update_running_jobs function while updating batch status -> ", e)
            continue

        print("Number of batch completed: ", result.matched_count)
        
def update_channel_database(output_file_id, unique_id):
    """
        Takes file path as an input and updates the channel database with the new data.
    """

    try:
        response = groq_client.files.content(output_file_id) # once fetched it will not be available anymore

        file_path = folder / f"{unique_id}_batch_results.jsonl"
        response.write_to_file(file_path)
    except Exception as e:
        print("ERR OCCURRED IN:: update_channel_database function while fetching processed file form groq or saving file locally -> ", e)
        return

    
    results = []
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                results.append(obj)
            except json.JSONDecodeError as e:
                print("Skipping bad line:", e)

    print(f"Parsed {len(results)} records")

    # can be used to validate results
    class ChannelCategoryAnalysis(BaseModel):
        channel_name: str = Field(description="The name of the YouTube channel")
        categories: List[int] = Field(
            min_length=1,
            max_length=3,
            description="Array of category integers (0-9)"
        )

        @field_validator('categories')
        @classmethod
        def validate_categories(cls, v):
            for cat in v:
                if not (0 <= cat <= 9):
                    raise ValueError(f'Category {cat} must be between 0 and 9')
            if len(v) != len(set(v)):
                raise ValueError('Categories must be unique')
            return v

    collection = db["channels"]
    bulk_ops=[]

    # TODO: iterate through result and save the result to database in bulk
    for result in results:
        try:
            content_raw = result["response"]["body"]["choices"][0]["message"]["content"]
            content_json = json.loads(content_raw)
            validated_result = ChannelCategoryAnalysis(**content_json)
            print("Success:")
            print(validated_result.model_dump_json(indent=2))
        except json.JSONDecodeError:
            # if it's not valid JSON, just keep it as string
            continue
        except Exception as e:
            print("ERR OCCURRED IN:: update_channel_database function while iterating through each channel categories -> ", e)
            continue

        try:

            channel_name = content_json["channel_name"]     # filter the doc
            categories = content_json["categories"]         # update the categories field in doc

            if not channel_name or not isinstance(categories, list):
                print("ERR IN LLM OUTPUT FORMAT:: channel_name not string or categories not list")
                continue 

            bulk_ops.append(
                UpdateOne(
                    filter={"channel_name": channel_name},        
                    update={"$set": {"channel_categories": categories, "status": 2}},
                    upsert=False                                 
                )
            )

        except Exception as e:
            print("ERR OCCURRED IN:: update_channel_database while preparing categories to save to MongoDB -> ", e)
            continue

    if bulk_ops:
        try:
            result = collection.bulk_write(bulk_ops)
            print(f"Matched: {result.matched_count}, Modified: {result.modified_count}")
        except Exception as e:
            print("ERR OCCURRED IN:: update_channel_database function while batch inserting categories -> ", e)
    else:
        print("No valid updates found.")

def shutdown_ec2():
    """
        Shutdown the ec2 instance if there are no jobs running.
    """
    ec2 = boto3.client('ec2')
    url = "http://169.254.169.254/latest/meta-data/instance-id"

    try:
        with urllib.request.urlopen(url, timeout=0.3) as response:
            instance_id = response.read().decode('utf-8')
            ec2.stop_instances(InstanceIds=[instance_id])
            print("STOPPED THE INSTANCE AFTER CRON JOB COMPLETION")
    except Exception:
        print("FAILED TO STOPPED THE INSTANCE AFTER CRON JOB COMPLETION")
        # send an email/any notification if failed

# TODO: Need to check if valid
def is_ec2_instance(timeout=0.1):
    url = "http://169.254.169.254/latest/meta-data/"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status == 200
    except Exception:
        return False

if __name__ == "__main__":
    # TODO: run two separate threads for both of them
    # execute_new_jobs()
    # update_running_jobs()

    new_job_thread = threading.Thread(target=execute_new_jobs)
    update_job_thread = threading.Thread(target=update_running_jobs)
    new_job_thread.start()
    update_job_thread.start()

    # # Wait for thread to complete
    new_job_thread.join()
    update_job_thread.join()

    # closing database connections 
    client.close()

    if is_ec2_instance():
        print("SHUTTING DOWN EC2 INSTANCE")
        shutdown_ec2()
    