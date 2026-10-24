#!/bin/zsh

# Read the process inventory from stdin so both historical executable names are checked.
nexo_process_list_has_app() {
    local current="$1/Contents/MacOS/Nexo" previous="$1/Contents/MacOS/ValentinaExperience"
    current=${current:A}
    previous=${previous:A}
    local process_path found=1
    while IFS= read -r process_path || [[ -n "$process_path" ]]; do
        [[ -n "$process_path" ]] || continue
        process_path=${process_path:A}
        if [[ "$process_path" == "$current" || "$process_path" == "$previous" ]]; then found=0; fi
    done
    return "$found"
}

nexo_installed_app_running() {
    local processes
    processes=$(/bin/ps -axo comm=) || return 2
    print -r -- "$processes" | nexo_process_list_has_app "$1"
}

nexo_require_app_closed() {
    local process_result=0
    nexo_installed_app_running "$1" || process_result=$?
    if [[ "$process_result" == 0 ]]; then
        print -u2 -- "Close Nexo before installing. The existing installation has been preserved."
        return 1
    elif [[ "$process_result" != 1 ]]; then
        print -u2 -- "Could not check whether Nexo is running. The existing installation has been preserved."
        return 1
    fi
}

# All replacement and rollback moves stay on the destination filesystem.
nexo_install_app() (
    set -euo pipefail
    local source_app=$1 output_dir=$2
    [[ -d "$source_app" ]] || { print -u2 -- "The built app is missing: $source_app"; exit 1; }
    mkdir -p "$output_dir" || exit 1
    output_dir=${output_dir:A}
    local installed_app="$output_dir/Nexo.app" transaction="" previous_app=""
    local lock_dir="$output_dir/.nexo-install.lock"
    local committed=false install_started=false
    mkdir "$lock_dir" 2>/dev/null || { print -u2 -- "Another Nexo installation is in progress: $lock_dir"; exit 1; }

    nexo_install_cleanup() {
        local result=$1
        trap - EXIT HUP INT TERM
        if [[ "$committed" != true ]]; then
            if [[ -n "$previous_app" && ( -e "$previous_app" || -L "$previous_app" ) ]]; then
                if [[ -e "$installed_app" || -L "$installed_app" ]]; then
                    if ! mv "$installed_app" "$transaction/rejected.app"; then
                        print -u2 -- "Rollback could not clear $installed_app. Previous app preserved at $previous_app"
                        return 1
                    fi
                fi
                if ! mv "$previous_app" "$installed_app"; then
                    print -u2 -- "Rollback could not restore $installed_app. Previous app preserved at $previous_app"
                    return 1
                fi
            elif [[ "$install_started" == true && ( -e "$installed_app" || -L "$installed_app" ) ]]; then
                mv "$installed_app" "$transaction/rejected.app" || return 1
            fi
        fi
        [[ -z "$transaction" ]] || rm -rf "$transaction"
        rmdir "$lock_dir"
        return "$result"
    }
    trap 'nexo_install_cleanup $?' EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM

    nexo_require_app_closed "$installed_app" || exit 1
    transaction=$(mktemp -d "$output_dir/.nexo-install.XXXXXXXX") || exit 1
    ditto "$source_app" "$transaction/incoming.app" || exit 1
    codesign --verify --deep --strict "$transaction/incoming.app" || exit 1
    # The app may have been opened while its replacement was being copied.
    nexo_require_app_closed "$installed_app" || exit 1
    if [[ -e "$installed_app" || -L "$installed_app" ]]; then
        local nonce=${transaction:t}
        previous_app="$output_dir/Nexo.previous-${nonce#.nexo-install.}.app"
        [[ ! -e "$previous_app" && ! -L "$previous_app" ]] || exit 1
        mv "$installed_app" "$previous_app" || exit 1
    fi
    install_started=true
    mv "$transaction/incoming.app" "$installed_app" || exit 1
    codesign --verify --deep --strict "$installed_app" || exit 1
    committed=true
    [[ -z "$previous_app" ]] || print -r -- "Previous app preserved: $previous_app"
)
