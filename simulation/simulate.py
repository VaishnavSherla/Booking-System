import csv
import json
import random
import threading
import requests
from faker import Faker

fake = Faker()

BASE_URL = "http://localhost:3000"
FLIGHT_ID = 14
DATE = "2024-05-26T06:00:00.000Z"

def generate_accounts(num_accounts):
    accounts = []
    for _ in range(num_accounts):
        username = fake.user_name()
        email = fake.email()
        password = fake.password()
        token = register(username, email, password)
        if token:
            accounts.append({"username": username, "email": email, "password": password, "token": token})
    with open('accounts.csv', 'w', newline='') as csvfile:
        fieldnames = ['username', 'email', 'password', 'token']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(accounts)

def register(username, email, password):
    url = f"{BASE_URL}/api/users/register"
    payload = {"username": username, "email": email, "password": password}
    headers = {"Content-Type": "application/json"}
    response = requests.post(url, data=json.dumps(payload), headers=headers)
    if response.status_code == 200:
        token = response.headers.get('auth-token')
        return token
    else:
        return None

def login(username, password):
    url = f"{BASE_URL}/api/users/login"
    payload = {"email": username, "password": password}
    headers = {"Content-Type": "application/json"}
    response = requests.post(url, data=json.dumps(payload), headers=headers)
    if response.status_code == 200:
        token = response.headers.get('auth-token')
        return token
    else:
        print(response)
        return None

def search_flights(token, date):
    url = f"{BASE_URL}/api/flights/by-date/{date}"
    headers = {"auth-token": token}
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        return response.json()
    else:
        return None

def book_seat(user,token, flight_id, seat_id, num):
    url = f"{BASE_URL}/api/bookings"
    payload = {"flight_id": flight_id, "seat_id": seat_id}
    headers = {"Content-Type": "application/json", "auth-token": token}
    print(user, "trying to book ", num)
    response = requests.post(url, data=json.dumps(payload), headers=headers)
    if response.status_code == 200:
        return True
    else:
        return False

def simulate_booking(username, password):
    with open('accounts.csv', newline='') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            if row['email'] == username and row['password'] == password:
                token = row['token']
                break
        else:
            print(f"User {username} not found in the CSV.")
            return

    if token:
        while True:
            seats = get_available_seats(token)
            if not seats:
                print(f"No available seats for user {username}")
                break
            
            seats_booked = 0
            for seat_to_book in seats:
                if seats_booked >= 3:  # Maximum of 3 seats
                    break
                success = book_seat(username, token, FLIGHT_ID, seat_to_book['seat_id'], seat_to_book['seat_number'])
                if success:
                    print(f"User {username} successfully booked seat {seat_to_book['seat_number']}")
                    seats_booked += 1
                else:
                    print(f"Failed to book seat {seat_to_book['seat_number']} for user {username}")

            if seats_booked == 0:
                print(f"Failed to book seat for user {username}")
                break
    else:
        print(f"Token not found for user {username}")

def get_available_seats(token):
    url = f"{BASE_URL}/api/seats/{FLIGHT_ID}/{DATE}"
    headers = {"auth-token": token}
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        available_seats = [seat for seat in response.json() if seat['seat_status']]
        random.shuffle(available_seats)
        return available_seats
    else:
        return []

def main():
    num_accounts = 5
    num_threads = 20

    generate_accounts(num_accounts)

    with open('accounts.csv', newline='') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            username = row['email']
            password = row['password']
            for _ in range(num_threads):
                threading.Thread(target=simulate_booking, args=(username, password)).start()

if __name__ == "__main__":
    main()
