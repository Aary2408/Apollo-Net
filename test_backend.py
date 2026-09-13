import requests

BASE = "http://127.0.0.1:8000"

print("Health:")
print(requests.get(BASE + "/api/health").json())

print("\nScenario:")
data = requests.get(BASE + "/api/scenario").json()
print("Drones:", len(data["drones"]))
print("Survivors:", len(data["survivors"]))

print("\nStarting:")
print(
    requests.post(
        BASE + "/api/control/start",
        json={"drone_count": 80}
    ).json()["running"]
)
