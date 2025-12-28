#!/usr/bin/env python3
"""
Port forwarder to allow Docker containers to reach LAN SQL Servers.
Run this on your Mac, then use host.docker.internal:1433 in the app.
"""
import socket
import threading
import sys

def forward(source, destination):
    try:
        while True:
            data = source.recv(4096)
            if not data:
                break
            destination.sendall(data)
    except:
        pass
    finally:
        source.close()
        destination.close()

def handle_client(client_socket, target_host, target_port):
    try:
        target = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        target.connect((target_host, target_port))

        t1 = threading.Thread(target=forward, args=(client_socket, target))
        t2 = threading.Thread(target=forward, args=(target, client_socket))
        t1.start()
        t2.start()
        t1.join()
        t2.join()
    except Exception as e:
        print(f"Connection error: {e}")
        client_socket.close()

def main():
    if len(sys.argv) != 3:
        print("Usage: python port-forward.py <target_host> <target_port>")
        print("Example: python port-forward.py 192.168.1.172 1433")
        sys.exit(1)

    target_host = sys.argv[1]
    target_port = int(sys.argv[2])
    local_port = 1433

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('0.0.0.0', local_port))
    server.listen(5)

    print(f"Forwarding localhost:{local_port} -> {target_host}:{target_port}")
    print("Docker containers can now use: host.docker.internal:1433")
    print("Press Ctrl+C to stop")

    try:
        while True:
            client, addr = server.accept()
            print(f"Connection from {addr}")
            thread = threading.Thread(target=handle_client, args=(client, target_host, target_port))
            thread.daemon = True
            thread.start()
    except KeyboardInterrupt:
        print("\nStopping...")
        server.close()

if __name__ == '__main__':
    main()
