CREATE TABLE standard_price (
    id SERIAL PRIMARY KEY,
    value DECIMAL(10, 2) NOT NULL
);

CREATE TABLE date_prices (
    id SERIAL PRIMARY KEY,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    CONSTRAINT unique_date_range UNIQUE (start_date, end_date)
);

INSERT INTO standard_price (value) VALUES (100.00);
