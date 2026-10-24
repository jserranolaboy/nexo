.DEFAULT_GOAL := help
DEVELOPER_DIR ?= /Applications/Xcode.app/Contents/Developer
NEXO_TEST_BUILD_DIR ?= /tmp/nexo-tests
export DEVELOPER_DIR

.PHONY: help test test-core test-native test-web test-installer check-locales build-web build-macos
help:
	@echo "Nexo: make test | check-locales | build-web | build-macos"
	@echo "build-macos installs Nexo.app; set NEXO_APP_DIR for a different destination."
test: test-core test-native test-web test-installer check-locales
test-core:
	swift test --package-path Core --scratch-path $(NEXO_TEST_BUILD_DIR)/core -j 2
test-native:
	NEXO_LIVE_DRIVE_TEST=0 swift test --package-path Native --scratch-path $(NEXO_TEST_BUILD_DIR)/native -j 2
test-web:
	cd Web && pnpm test
test-installer:
	zsh scripts/test-install-macos.zsh
check-locales:
	node scripts/sync-locales.mjs --check
build-web:
	cd Web && pnpm build
build-macos:
	zsh scripts/build-macos.sh
