src/proto/server.gen.ts: ../protocol/server.proto 
	mkdir -p src/proto
	node_modules/.bin/protoc \
		--plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=esModuleInterop=true,returnObservable=false,outputServices=generic-definitions,oneof=unions \
		--ts_proto_opt=fileSuffix=.gen \
		--ts_proto_out="$(PWD)/src/proto" \
		-I="$(realpath ../protocol/)" \
	"$(realpath ../protocol/server.proto)"

src/proto/p2p.gen.ts: ../protocol/p2p.proto 
	mkdir -p src/proto
	node_modules/.bin/protoc \
		--plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=esModuleInterop=true,returnObservable=false,outputServices=generic-definitions,oneof=unions \
		--ts_proto_opt=fileSuffix=.gen \
		--ts_proto_out="$(PWD)/src/proto" \
		-I="$(realpath ../protocol/)" \
	"$(realpath ../protocol/p2p.proto)"

build: src/proto/server.gen.ts src/proto/p2p.gen.ts
	./node_modules/.bin/tsc -p tsconfig.json

.PHONY: build build-proto observe
