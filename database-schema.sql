-- Table: places (airports / cities)
CREATE TABLE places (
    place_id SERIAL PRIMARY KEY,
    airport_code VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    city VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL
);

-- Table: aircraft
CREATE TABLE aircraft (
    aircraft_id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    total_seats INTEGER,
    is_deleted BOOLEAN DEFAULT FALSE
);
-- Redis keys (not SQL — documented here for reference)
-- seat_lock:{seat_id}          → "{user_id}:{reservation_id}"  TTL 600s
-- reservation:{reservation_id} → JSON {seat_id, flight_id, user_id}  TTL 600s
-- Keys auto-expire if user abandons checkout; deleted on confirm

-- Table: bookings
CREATE TABLE bookings (
    booking_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id),
    flight_id INTEGER REFERENCES flights(flight_id),
    seat_id INTEGER REFERENCES seats(seat_id),
    booking_time TIMESTAMP(6)
);
-- Table: flights
CREATE TABLE flights (
    flight_id SERIAL PRIMARY KEY,
    flight_number VARCHAR(20),
    departure_airport VARCHAR(100),
    destination_airport VARCHAR(100),
    departure_time TIMESTAMP(6),
    arrival_time TIMESTAMP(6),
    aircraft_id INTEGER REFERENCES aircraft(aircraft_id),
    price NUMERIC(10,2),
    is_deleted BOOLEAN DEFAULT FALSE
);
-- Table: seats
CREATE TABLE seats (
    seat_id SERIAL PRIMARY KEY,
    flight_id INTEGER REFERENCES flights(flight_id),
    seat_number VARCHAR(10),
    seat_status BOOLEAN
);
-- Table: users
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50),
    email VARCHAR(100),
    password VARCHAR(256),
    is_deleted BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE
);