install:
	cd server; npm ci
	cd p2p; npm ci

build:
	cd server; make build
	cd p2p; make build
