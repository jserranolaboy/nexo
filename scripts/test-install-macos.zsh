#!/bin/zsh
set -euo pipefail
script_dir=${0:A:h}
source "$script_dir/install-macos.zsh"
test_root=$(mktemp -d "${TMPDIR:-/tmp/}nexo-install-tests.XXXXXXXX")
test_root=${test_root:A}
trap 'rm -rf "$test_root"' EXIT

fail() { print -u2 -- "FAIL: $*"; exit 1; }
local_app="$test_root/Applications with spaces/Nexo.app"
for executable in Nexo ValentinaExperience; do
    print -r -- "$local_app/Contents/MacOS/$executable" | nexo_process_list_has_app "$local_app" || fail "running $executable was missed"
done
if print -r -- "$local_app.other/Contents/MacOS/Nexo" | nexo_process_list_has_app "$local_app"; then
    fail "process guard matched a different bundle"
fi

run_case() (
    local scenario=$1
    local root="$test_root/$scenario" output="$test_root/$scenario/output"
    local source_app="$root/source/Nexo.app" target="$output/Nexo.app"
    mkdir -p "$source_app/Contents/MacOS" "$target/Contents/MacOS"
    print -r -- "new executable" > "$source_app/Contents/MacOS/Nexo"
    print -r -- "old executable" > "$target/Contents/MacOS/Nexo"
    print -r -- "old resource" > "$target/Contents/resource"
    chmod 701 "$target/Contents/MacOS/Nexo"
    ln -s resource "$target/Contents/resource-link"
    ditto "$target" "$root/expected-old.app"
    if [[ "$scenario" == fresh-* ]]; then rm -rf "$target"; fi
    local install_output="$output"
    if [[ "$scenario" == relative-* ]]; then
        cd "$root"
        install_output=output
    elif [[ "$scenario" == alias-* || "$scenario" == real-target-* ]]; then
        ln -s "$output" "$root/output-alias"
        if [[ "$scenario" == alias-* ]]; then install_output="$root/output-alias"; fi
    fi
    local process_checks=0
    nexo_installed_app_running() {
        process_checks=$((process_checks + 1))
        case "$scenario" in
            running-new) print -r -- "$1/Contents/MacOS/Nexo" | nexo_process_list_has_app "$1" ;;
            running-old) print -r -- "$1/Contents/MacOS/ValentinaExperience" | nexo_process_list_has_app "$1" ;;
            relative-running-new|alias-target-running-real-new) print -r -- "$target/Contents/MacOS/Nexo" | nexo_process_list_has_app "$1" ;;
            relative-running-old|alias-target-running-real-old) print -r -- "$target/Contents/MacOS/ValentinaExperience" | nexo_process_list_has_app "$1" ;;
            real-target-running-alias-new) print -r -- "$root/output-alias/Nexo.app/Contents/MacOS/Nexo" | nexo_process_list_has_app "$1" ;;
            real-target-running-alias-old) print -r -- "$root/output-alias/Nexo.app/Contents/MacOS/ValentinaExperience" | nexo_process_list_has_app "$1" ;;
            process-check-failure) return 2 ;;
            running-after-copy)
                [[ "$process_checks" -gt 1 ]] || return 1
                print -r -- "$1/Contents/MacOS/Nexo" | nexo_process_list_has_app "$1" ;;
            *) return 1 ;;
        esac
    }
    ditto() {
        if [[ "$scenario" == copy-failure ]]; then
            mkdir -p "$2"; print partial > "$2/partial"
            return 1
        fi
        command /usr/bin/ditto "$@"
    }
    mv() {
        if [[ "$scenario" == old-move-failure && "$1" == "$target" ]]; then return 1; fi
        if [[ "$1" == */incoming.app && "$2" == "$target" ]]; then
            if [[ "$scenario" == final-move-failure || "$scenario" == fresh-move-failure ]]; then return 1; fi
            if [[ "$scenario" == move-then-failure ]]; then command /bin/mv "$@"; return 1; fi
        fi
        command /bin/mv "$@"
    }
    codesign() {
        local verified=${@[-1]}
        [[ "$verified" == "$output"/* ]] || fail "verification was not on destination filesystem"
        if [[ "$scenario" == stage-signature-failure && "$verified" == */incoming.app ]]; then return 1; fi
        if [[ ( "$scenario" == final-signature-failure || "$scenario" == fresh-signature-failure ) && "$verified" == "$target" ]]; then return 1; fi
        return 0
    }
    assert_old_bundle() {
        diff -qr "$root/expected-old.app" "$1" || fail "$scenario changed the previous bundle"
        [[ -L "$1/Contents/resource-link" && "$(readlink "$1/Contents/resource-link")" == resource ]] || fail "$scenario changed a previous symlink"
        [[ "$(/usr/bin/stat -f %Lp "$1/Contents/MacOS/Nexo")" == 701 ]] || fail "$scenario changed previous permissions"
    }
    if nexo_install_app "$source_app" "$install_output" > "$root/result.log" 2>&1; then
        [[ "$scenario" == success || "$scenario" == fresh-success || "$scenario" == relative-success ]] || fail "$scenario unexpectedly succeeded"
        diff -qr "$source_app" "$target" || fail "$scenario installed bytes differ"
        if [[ "$scenario" == success || "$scenario" == relative-success ]]; then
            local backups=("$output"/Nexo.previous-*.app(N))
            [[ ${#backups} == 1 ]] || fail "previous app missing after success"
            assert_old_bundle "$backups[1]"
        fi
    else
        [[ "$scenario" != success && "$scenario" != fresh-success && "$scenario" != relative-success ]] || { cat "$root/result.log"; fail "$scenario failed"; }
        if [[ "$scenario" == fresh-* ]]; then
            [[ ! -e "$target" ]] || fail "$scenario left a failed installation"
        else
            assert_old_bundle "$target"
        fi
        local backups=("$output"/Nexo.previous-*.app(N))
        [[ ${#backups} == 0 ]] || fail "$scenario left the old app away from its installed path"
    fi
    [[ ! -e "$output/.nexo-install.lock" ]] || fail "$scenario leaked installation lock"
    local transactions=("$output"/.nexo-install.*(N))
    [[ ${#transactions} == 0 ]] || fail "$scenario leaked transaction directory"
    print -r -- "PASS: $scenario"
)
for scenario in success copy-failure old-move-failure final-move-failure move-then-failure stage-signature-failure final-signature-failure running-new running-old process-check-failure running-after-copy fresh-success fresh-move-failure fresh-signature-failure relative-success relative-running-new relative-running-old alias-target-running-real-new alias-target-running-real-old real-target-running-alias-new real-target-running-alias-old; do
    run_case "$scenario"
done
print -r -- "PASS: current/previous process names and 21 synthetic installation scenarios"
