#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "NeonHUD.generated.h"

/** Canvas HUD: clock, money, vehicle gauges, prompts, NPC speech bubbles and a simulation debug overlay (N). */
UCLASS()
class PROJECTNEON_API ANeonHUD : public AHUD
{
	GENERATED_BODY()
public:
	virtual void DrawHUD() override;

private:
	void Text(const FString& S, float X, float Y, const FLinearColor& C, float Scale = 1.f, bool bBox = false, bool bCenter = false);
	void DrawBubbles();
	void DrawDebug();
};
