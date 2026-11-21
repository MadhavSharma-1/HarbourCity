#include "NPC/NPCRelationshipComponent.h"

FNeonRelationship& UNPCRelationshipComponent::Get(FName Other)
{
	if (FNeonRelationship* R = Relationships.FindByPredicate([Other](const FNeonRelationship& X) { return X.OtherId == Other; })) return *R;
	FNeonRelationship& R = Relationships.AddDefaulted_GetRef();
	R.OtherId = Other;
	return R;
}

const FNeonRelationship* UNPCRelationshipComponent::Find(FName Other) const
{
	return Relationships.FindByPredicate([Other](const FNeonRelationship& X) { return X.OtherId == Other; });
}

void UNPCRelationshipComponent::Adjust(FName Other, float DA, float DT, float DF, double Now)
{
	FNeonRelationship& R = Get(Other);
	R.Affinity = FMath::Clamp(R.Affinity + DA, -1.f, 1.f);
	R.Trust = FMath::Clamp(R.Trust + DT, 0.f, 1.f);
	R.Familiarity = FMath::Clamp(R.Familiarity + DF, 0.f, 1.f);
	if (DA < -0.15f) R.Conflicts++;
	// romance only grows between people who already like and know each other well (never toward the player here)
	if (Other != NeonNames::Player && R.Affinity > 0.7f && R.Familiarity > 0.6f && DA > 0.f) R.Romance = FMath::Clamp(R.Romance + DA * 0.5f, 0.f, 1.f);
	if (R.Affinity < 0.2f) R.Romance = FMath::Max(0.f, R.Romance - 0.05f);
	R.LastInteraction = Now;
}

FString UNPCRelationshipComponent::Label(FName Other) const
{
	const FNeonRelationship* R = Find(Other);
	if (!R || R->Familiarity < 0.08f) return TEXT("stranger");
	if (R->Romance > 0.6f) return TEXT("partner");
	if (R->Affinity < -0.6f) return TEXT("enemy");
	if (R->Affinity < -0.25f) return TEXT("rival");
	if (R->Affinity > 0.65f) return TEXT("close friend");
	if (R->Affinity > 0.3f) return TEXT("friend");
	return TEXT("acquaintance");
}

FName UNPCRelationshipComponent::FavouriteAmong(const TArray<FName>& Candidates) const
{
	FName Best; float BestScore = -10.f;
	for (const FName& C : Candidates)
	{
		const FNeonRelationship* R = Find(C);
		const float S = R ? R->Affinity + R->Romance * 0.5f + R->Familiarity * 0.2f : 0.f;
		if (S > BestScore) { BestScore = S; Best = C; }
	}
	return Best;
}
