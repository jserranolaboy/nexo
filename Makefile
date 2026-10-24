.DEFAULT_GOAL := help
DEVELOPER_DIR ?= /Applications/Xcode.app/Contents/Developer
NEXO_TEST_BUILD_DIR ?= /tmp/nexo-tests
export DEVELOPER_DIR

.PHONY: help test test-core test-native test-web test-reconstruction test-adapter check-locales build-web build-macos
help:
	@echo "Nexo: make test | test-reconstruction | test-adapter | check-locales | build-web | build-macos"
	@echo "build-macos installs Nexo.app; set NEXO_APP_DIR for a different destination."
	@echo "test-reconstruction runs without Xcode. test-adapter is the Mac kernel adapter."
test: test-core test-native test-web check-locales
test-core:
	swift test --package-path Core --scratch-path $(NEXO_TEST_BUILD_DIR)/core -j 2
test-native:
	NEXO_LIVE_DRIVE_TEST=0 swift test --package-path Native --scratch-path $(NEXO_TEST_BUILD_DIR)/native -j 2
test-web:
	cd Web && pnpm test
test-reconstruction:
	cd reconstruction && npm test && npm run typecheck
test-adapter:
	cd reconstruction/apple && xcodebuild -scheme nexo-adapter -destination 'platform=macOS' -derivedDataPath /tmp/nexo-adapter-dd CODE_SIGNING_ALLOWED=NO ENABLE_HARDENED_RUNTIME=NO test
check-locales:
	node scripts/sync-locales.mjs --check
build-web:
	cd Web && pnpm build
build-macos:
	zsh scripts/build-macos.sh
