import os
import shutil
import subprocess
import sys

def main():
    sdk_dir = os.path.dirname(os.path.abspath(__file__))
    print(f"SDK directory: {sdk_dir}")

    module_name = "A7672S_LASC_1603_CD_V101_OPENSDK"
    aboot_src = os.path.join(sdk_dir, "kernel", module_name, "aboot")
    out_dir = os.path.join(sdk_dir, "out", module_name)
    aboot_dst = os.path.join(out_dir, "aboot")
    
    # 1. Clean and recreate aboot directory in out/
    if os.path.exists(aboot_dst):
        print(f"Cleaning existing directory: {aboot_dst}")
        try:
            shutil.rmtree(aboot_dst)
        except Exception as e:
            print(f"Warning: Failed to delete {aboot_dst}: {e}")
    
    print(f"Copying {aboot_src} to {aboot_dst}")
    shutil.copytree(aboot_src, aboot_dst)

    # 2. Copy customer_app_crc.bin to aboot/images/customer_app.bin
    app_src = os.path.join(sdk_dir, "out", "build", "customer_app_crc.bin")
    app_dst = os.path.join(aboot_dst, "images", "customer_app.bin")

    if not os.path.exists(app_src):
        # Fallback to customer_app.bin if _crc.bin doesn't exist
        app_src = os.path.join(sdk_dir, "out", "build", "customer_app.bin")
        if not os.path.exists(app_src):
            print(f"Error: Could not find compiled app binary at {app_src}")
            sys.exit(1)

    print(f"Copying {app_src} to {app_dst}")
    shutil.copy2(app_src, app_dst)

    # 3. Define arelease command
    arelease_path = os.path.join(sdk_dir, "tools", "win32", "aboot", "arelease.exe")
    if not os.path.exists(arelease_path):
        print(f"Error: arelease.exe not found at {arelease_path}")
        sys.exit(1)

    burn_zip = os.path.join(out_dir, "burn.zip")
    burn_source_zip = os.path.join(out_dir, "burn_source.zip")
    
    # Clean old zips
    for f in [burn_zip, burn_source_zip]:
        if os.path.exists(f):
            try:
                os.remove(f)
            except Exception as e:
                print(f"Warning: Failed to remove {f}: {e}")

    # CMD: arelease.exe -c <aboot_dst> -g -p ASR_CRANEM_EVB -v CRANEM_A0_08MB_OPENSDK --release-pack <burn_source_zip> <burn_zip>
    cmd = [
        arelease_path,
        "-c", aboot_dst,
        "-g",
        "-p", "ASR_CRANEM_EVB",
        "-v", "CRANEM_A0_08MB_OPENSDK",
        "--release-pack", burn_source_zip,
        burn_zip
    ]

    print(f"Running command: {' '.join(cmd)}")
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    
    print("STDOUT:")
    print(result.stdout)
    print("STDERR:")
    print(result.stderr)

    if result.returncode == 0:
        print("Success! Generated packages:")
        print(f"  Flash package: {burn_zip}")
        print(f"  Source package: {burn_source_zip}")
        
        # Also copy it to a more convenient place (like root workspace or target folder)
        root_workspace = os.path.dirname(sdk_dir)
        convenient_zip = os.path.join(root_workspace, "SC_A7672S_LASC_8M_CUSTOMER_APP.zip")
        shutil.copy2(burn_zip, convenient_zip)
        print(f"Copied flashable ZIP to: {convenient_zip}")
    else:
        print(f"Error: arelease failed with exit code {result.returncode}")
        sys.exit(1)

if __name__ == "__main__":
    main()
