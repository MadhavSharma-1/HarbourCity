#pragma once

#include "CoreMinimal.h"

class UMaterialInstanceDynamic;
class UMaterialInterface;

/**
 * Materials without any project assets. In the editor (PIE) two small parameterised materials
 * are built at runtime (lit surface + emissive glow); in packaged builds the engine's
 * BasicShapeMaterial is used. Replace with real PBR materials (Fab/Quixel) for photorealism.
 */
namespace NeonMaterials
{
	PROJECTNEON_API UMaterialInterface* BaseSurface();
	PROJECTNEON_API UMaterialInterface* BaseGlow();
	PROJECTNEON_API UMaterialInstanceDynamic* Surface(UObject* Outer, const FLinearColor& Color, float Roughness = 0.7f, float Metallic = 0.f);
	PROJECTNEON_API UMaterialInstanceDynamic* Glow(UObject* Outer, const FLinearColor& Color, float Intensity);
}
