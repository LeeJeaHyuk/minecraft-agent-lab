# Sources and reuse

| Source | Use | License |
|---|---|---|
| [PrismarineJS/Mineflayer](https://github.com/PrismarineJS/mineflayer) | Installed dependency for Minecraft protocol/bot API | MIT |
| [Mineflayer pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) | Installed dependency for deterministic movement | MIT |
| [jaredpalmer/kev](https://github.com/jaredpalmer/kev) | Official server in ignored vendor clone, unmodified | Apache-2.0 |
| [Kev-4B](https://huggingface.co/jaredpalmer/kev-4b) | Official adapter/head and pinned base in local cache | Apache-2.0 |
| [Hermes/Jev Minecraft](https://github.com/teknium1/hermes-and-jev-play-minecraft) | Architectural reference for bounded choices; no code copied | MIT |
| [rmalde/minecraft-agent](https://github.com/rmalde/minecraft-agent) | Architectural reference only; no code copied, no routes/tasks reused | No reuse license established |
| [Minecraft Java server](https://www.minecraft.net/eula) | Official binary downloaded independently; never committed | Minecraft EULA |
| [Eclipse Temurin](https://adoptium.net/) | Portable Java runtime downloaded and checksum verified, ignored | Upstream OpenJDK distribution licenses |

Transitive package license notices remain in node_modules and the Kev environment. This repository implements its environment and policy adapters independently. The short-goal orchestrator independently implements milestone-based asynchronous planning and stale-response rejection as architectural ideas. The referenced seed routes, combat logic and task-specific candidate rules were not copied.
