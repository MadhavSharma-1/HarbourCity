#pragma once

#include "CoreMinimal.h"

class ANeonNPC;
class UWorld;
class UNeonSimSubsystem;

/** The ten founding citizens of the district: identities, traits, jobs, homes, routines, relationships. */
namespace NeonRoster
{
	PROJECTNEON_API TArray<ANeonNPC*> SpawnAll(UWorld* World, UNeonSimSubsystem* Sim);
}
