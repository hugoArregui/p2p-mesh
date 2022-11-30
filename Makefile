install:
	cd lib; npm ci
	cd server; npm ci
	cd simulation; npm ci
	cd chat; npm ci

build:
	cd lib; make build
	cd server; make build
	cd simulation; make build
