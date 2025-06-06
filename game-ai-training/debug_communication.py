#!/usr/bin/env python3

import subprocess
import json
import time

def debug_node_communication():
    print("=== Debug Node.js Communication ===")
    
    try:
        print("Starting Node.js process...")
        process = subprocess.Popen(
            ['node', 'game_wrapper.js'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd='game',
            bufsize=0  # Unbuffered
        )
        
        print("Waiting for output...")
        
        # Read all available output for 5 seconds
        start_time = time.time()
        all_output = []
        
        while time.time() - start_time < 5:
            try:
                # Use poll to check if there's data available
                process.stdout.settimeout(0.1)
                line = process.stdout.readline()
                if line:
                    line = line.strip()
                    print(f"RAW OUTPUT: {repr(line)}")
                    all_output.append(line)
                    
                    # Check if it's the ready signal
                    if line.startswith('{'):
                        try:
                            data = json.loads(line)
                            if data.get('ready'):
                                print("✓ Found ready signal!")
                                break
                        except:
                            pass
            except:
                time.sleep(0.1)
                continue
        
        print(f"\nAll output received: {all_output}")
        
        # Try to send reset command
        print("\nSending reset command...")
        process.stdin.write('{"action":"reset"}\n')
        process.stdin.flush()
        
        # Read response
        print("Waiting for reset response...")
        start_time = time.time()
        while time.time() - start_time < 10:
            try:
                line = process.stdout.readline()
                if line:
                    line = line.strip()
                    print(f"RESET RESPONSE: {repr(line)}")
                    
                    if line.startswith('{'):
                        try:
                            data = json.loads(line)
                            print(f"✓ Valid JSON response: {data}")
                            if data.get('success'):
                                print("✓ Reset successful!")
                                return True
                        except Exception as e:
                            print(f"JSON parse error: {e}")
            except:
                time.sleep(0.1)
                continue
        
        print("❌ No valid response received")
        return False
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'process' in locals():
            process.terminate()

if __name__ == "__main__":
    debug_node_communication()

