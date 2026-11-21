#include "NPC/NPCEmotionComponent.h"

void UNPCEmotionComponent::Stimulate(float DV, float DA, float DF, float DAng, float DJ)
{
	Valence = FMath::Clamp(Valence + DV, -1.f, 1.f);
	Arousal = FMath::Clamp(Arousal + DA, 0.f, 1.f);
	Fear = FMath::Clamp(Fear + DF, 0.f, 1.f);
	Anger = FMath::Clamp(Anger + DAng, 0.f, 1.f);
	Joy = FMath::Clamp(Joy + DJ, 0.f, 1.f);
	Stress = FMath::Clamp(Stress + FMath::Max(0.f, DF + DAng) * 0.5f, 0.f, 1.f);
}

void UNPCEmotionComponent::Decay(double Hours)
{
	const float K = 1.f - FMath::Exp(-(float)Hours * 1.5f); // most of a spike fades in ~1 game hour
	Valence = FMath::Lerp(Valence, BaselineValence, K * 0.5f);
	Arousal = FMath::Lerp(Arousal, 0.15f, K);
	Fear = FMath::Lerp(Fear, 0.f, K);
	Anger = FMath::Lerp(Anger, 0.f, K * 0.6f);
	Joy = FMath::Lerp(Joy, FMath::Max(0.f, BaselineValence), K * 0.5f);
	Stress = FMath::Lerp(Stress, BaselineStress, K * 0.3f);
}

FString UNPCEmotionComponent::Describe() const
{
	if (Fear > 0.5f) return TEXT("frightened");
	if (Anger > 0.5f) return TEXT("angry");
	if (Stress > 0.6f) return TEXT("stressed");
	if (Valence > 0.45f) return TEXT("cheerful");
	if (Valence < -0.3f) return TEXT("down");
	if (Arousal > 0.6f) return TEXT("on edge");
	return TEXT("calm");
}
