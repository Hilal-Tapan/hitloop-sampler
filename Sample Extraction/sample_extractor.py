# Imports
import numpy as np
import librosa
import soundfile as sf
import os
from matplotlib import pyplot as plt
from scipy.ndimage import zoom
from numpy.linalg import norm
from sklearn.metrics.pairwise import cosine_distances, euclidean_distances
from sklearn.metrics import pairwise_distances
import random
import concurrent.futures
from flask import *
from flask_cors import CORS, cross_origin
import wave
import logging
import asyncio
import io
import jsonpickle
from mimetypes import guess_extension

# create app
app = Flask(__name__)

# FLask CORS
cors = CORS(app)
loop = asyncio.get_event_loop()
app.config['CORS_HEADERS'] = 'Content-Type'

# Global sampling rate
sample_rate = 48000
std_stride = 0.5
noise_threshold = 0.2

# Folder used for output samples
output_folder_1 = 'samples_3'

# Folder where the example samples are stored
samples_folder = 'Inputs/Samples'


def array_to_feature_1(input_array: np.array) -> np.array:
    """Function to convert numpy array to feature 1

    Args:
        input_array (np.array): Array to be converted

    Returns:
        np.array: mel spectogram
    """

    feat_1 = librosa.feature.melspectrogram(y=input_array, sr=sample_rate)
    feat_1 = librosa.power_to_db(feat_1).astype(np.float32)

    # # feat_1 = librosa.stft(y=input_array)

    return feat_1


def array_to_feature_2(input_array: np.array) -> np.array:
    """Function to convert numpy array to feature 2

    Args:
        input_array (np.array): Array to be converted

    Returns:
        np.array: mel spectogram
    """

    # # feat_2 = librosa.feature.chroma_cens(y=input_array, sr= sample_rate)
    # # feat_2 = librosa.power_to_db(feat_2).astype(np.float32)

    feat_2 = librosa.feature.spectral_contrast(y=input_array, sr=sample_rate)

    # feat_2 = librosa.feature.mfcc(y=input_array, sr= sample_rate)

    return feat_2


def array_to_feature_3(input_array: np.array) -> np.array:
    """Function to convert numpy array to feature 3
    Tried Spectral Bandwidth

    Args:
        input_array (np.array): Array to be converted

    Returns:
        np.array: mel spectogram
    """

    feat_3 = librosa.feature.spectral_bandwidth(y=input_array, sr=sample_rate)
    # feat_3 = librosa.power_to_db(feat_3).astype(np.float32)

    return feat_3


def calculate_window_length():
    """Function to calculate window length

    Returns:
        int: window length
    """

    # Get all audio files
    audio_files = []
    base_folder = os.path.dirname(os.path.realpath(__file__))
    samples_folder = os.path.join(base_folder, 'Inputs', 'Samples')

    for instrument_type in os.listdir(samples_folder):
        for file in os.listdir(os.path.join(samples_folder, instrument_type)):
            file_path = os.path.join(samples_folder, instrument_type, file)
            y = librosa.load(file_path, sr=sample_rate, mono=True)[0]
            audio_files.append(y)

    # Calculate shortest audio length for window length 
    audio_len = [len(file) for file in audio_files]
    window_len = np.min(audio_len)

    # Make sure sample is maximum of 1 second
    window_len = min(window_len, sample_rate)

    return window_len


def create_sample_info(samples_folder: str) -> list:
    """Function for creating the info we need from each sample to detect the Samples

    Args:
        samples_folder (str): Folder which contains the sample type
        sample_rate (int, optional): sample_rate of output. Defaults to 44100.

    Returns:
        list: list with the following information: [length of the sample , Mel-spectogram pattern , chroma-cens pattern , Spectral-bandwidth pattern]
    """

    # Get all audio files in sample folder
    audio_files = []

    files_list = os.listdir(samples_folder)

    for file in files_list:
        file_path = os.path.join(samples_folder, file)
        y = librosa.load(file_path, sr=sample_rate, mono=True)[0]
        audio_files.append(y)

    # Create_list of all features
    all_mel_spec = []
    all_chroma_cens = []
    all_spec_band = []

    window_len = calculate_window_length()

    for file in audio_files:
        file = file[:window_len]

        mel_spec = array_to_feature_1(file)
        all_mel_spec.append(mel_spec)

        chroma_cens = array_to_feature_2(file)
        all_chroma_cens.append(chroma_cens)

        spec_band = array_to_feature_3(file)
        all_spec_band.append(spec_band)

    # Calculate average for each feature and turn it into list
    average_melspec = np.mean(all_mel_spec, axis=0)
    average_chromacens = np.mean(all_chroma_cens, axis=0)
    average_specband = np.mean(all_spec_band, axis=0)

    sample_info_list = [window_len, average_melspec, average_chromacens, average_specband]

    return sample_info_list


def distance(window: np.array, compare_pattern: np.array):
    """_summary_

    Args:
        window (np.array): Current window extracted from sliding window function
        compare_pattern (np.array): Pattern the window has to be compared to

    Returns:
        cosine similairity of window and pattern
    """

    #
    A = window.flatten().reshape(1, -1)
    B = compare_pattern.flatten().reshape(1, -1)

    # Cosine
    distance = cosine_distances(A, B)

    # # Euclidean
    # distance = euclidean_distances(A,B)

    # #Pearson
    # distance = pairwise_distances(A, B, metric='correlation')

    distance = distance[0][0]

    # distance = random.uniform(0,1)
    return distance


def sliding_window(input_array, compare_info: list, stride: float, threshold: float):
    """
    Create a sliding window over a 2D numpy array.

    Parameters:
    arr (numpy array): Input 1D numpy array of the audio file that needs to be compared
    window_size (float): Size of the sliding window samples. take from 1st index in sample_info
    compare_info (list): pattern that will be compared against with output of create_sample_info()
    stride (float): amount of the window_size to move when incorrect
    threshold (float): Threshold of combined cosine similairity between the three types needed to get a 'matching pattern'

    Returns:
    windows (list): List of numpy arrays representing the sliding windows that meet the requirement
    """
    window_size = compare_info[0]
    compare_melspec = compare_info[1]
    compare_chromacens = compare_info[2]
    compare_specband = compare_info[3]

    stride_step = int(stride * window_size)
    windows = []
    i = 0
    n_times = 0
    while i + window_size <= len(input_array):
        window = input_array[i:i + window_size]

        # Calculate how similair audio is to noise. If 1 it is noise Check if the highest noiselike window is over this threshold
        noise_like = np.max(librosa.feature.spectral_flatness(y=window))
        max_db = np.max(librosa.amplitude_to_db(window))
        if noise_like < noise_threshold:

            # calculate similairities
            mel_spec = array_to_feature_1(window)
            db = librosa.power_to_db(mel_spec)
            max_db = int(np.max(db))
            print(max_db)
            mel_cosine = distance(mel_spec, compare_melspec)

            chroma_cens = array_to_feature_2(window)
            chroma_cosine = distance(chroma_cens, compare_chromacens)

            spec_band = array_to_feature_3(window)
            specband_cosine = distance(spec_band, compare_specband)

            combined_similairity = mel_cosine + chroma_cosine + specband_cosine

            if combined_similairity < threshold and max_db > 8:
                i += window_size
                n_times += 1
                windows.append(window)
            else:
                i += stride_step
                n_times += 1

        else:
            i += stride_step
            n_times += 1

    print(f'Used {n_times} windows to find {len(windows)} patterns')
    return windows


def create_pattern_and_types():
    sample_patterns = []

    base_folder = os.path.dirname(os.path.realpath(__file__))
    samples_folder = os.path.join(base_folder, 'Inputs', 'Samples')
    sample_types = os.listdir(samples_folder)

    for sample_type in sample_types:
        sample_folder = os.path.join(samples_folder, sample_type)
        pattern = create_sample_info(sample_folder)
        sample_patterns.append(pattern)

    return sample_patterns, sample_types


async def extract_samples_from_wav(wav_blob, output_samples_path):
    # Load the temp file as a wave file so it can be used to extract samples
    audio_file, _ = librosa.load('temp.wav', sr=sample_rate, mono=True)

    # Define std_stride and threshold based on your requirements
    std_stride = 0.5
    threshold = 2

    # Remove the temp file
    # os.remove('temp.wav')

    # Assuming create_pattern_and_types() is defined elsewhere
    sample_patterns, sample_types = create_pattern_and_types()

    print(f'Extracting samples from recording...')

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = []

        for i in range(len(sample_patterns)):
            pattern = sample_patterns[i]
            sample_name = sample_types[i]

            # Submit the task to the executor, which will run it in a thread
            future = executor.submit(
                sliding_window, input_array=audio_file, compare_info=pattern,
                stride=std_stride, threshold=threshold)

            futures.append((future, sample_name))

        # Wait for all tasks to complete and extract the results
        for future, sample_name in futures:
            pattern_windows = future.result()

            # If there are samples, extract them
            if len(pattern_windows) > 0:
                for i, sample_window in enumerate(pattern_windows):
                    file_name = f'{sample_name}_{i}_sample.wav'
                    out_path = os.path.join(output_samples_path, file_name)

                    # Write the sample to disk
                    sf.write(out_path, sample_window, sample_rate)


# Create endpoint for creating custom samples
@app.route('/upload', methods=['POST'])
@cross_origin()
def create_custom_samples():
    custom_samples = []

    base_path = os.path.dirname(os.path.realpath(__file__))

    # del output folder if it exists
    if os.path.exists(os.path.join(base_path, output_folder_1)):
        for file in os.listdir(os.path.join(base_path, output_folder_1)):
            os.remove(os.path.join(base_path, output_folder_1, file))
        os.rmdir(os.path.join(base_path, output_folder_1))
    os.makedirs(os.path.join(base_path, output_folder_1))

    output_path = os.path.join(base_path, output_folder_1)

    print(request.files)

    if 'file' in request.files:
        file = request.files['file']
        extname = guess_extension(file.content_type)
        print(type(extname))
        file.save('temp.wav')
        loop.run_until_complete(extract_samples_from_wav(file, output_path))
        # Send back the samples
        for file in os.listdir(output_path):
            custom_samples.append(file)

        return jsonpickle.encode(custom_samples)


if __name__ == '__main__':
    app.run(debug=True, workers=4)
