#include "NPC/NPCRoster.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCIdentityComponent.h"
#include "NPC/NPCNeedsComponent.h"
#include "NPC/NPCScheduleComponent.h"
#include "NPC/NPCMemoryComponent.h"
#include "NPC/NPCRelationshipComponent.h"
#include "Core/NeonSimSubsystem.h"
#include "Engine/World.h"

namespace
{
	struct FDef
	{
		const TCHAR* Id; const TCHAR* First; const TCHAR* Last; int32 Age; bool bFemale;
		const TCHAR* Job; const TCHAR* Work; const TCHAR* Home;
		const TCHAR* Backstory; const TCHAR* Appearance; FLinearColor Clothes;
		// friendliness, aggression, confidence, curiosity, empathy, honesty, risk, loyalty, sociability
		float T[9];
		float Money, Wage, Rent, Wake, Start, End; bool bWeekends; bool bEmployed;
	};

	const FDef Defs[] = {
		{ TEXT("NPC_DANIEL"), TEXT("Daniel"), TEXT("Okafor"), 34, false, TEXT("software developer"), TEXT("LumenLabs"), TEXT("HarborView"),
		  TEXT("Moved to Harbor Point two years ago for a job at Lumen Labs. Works on routing software, plays five-a-side on Thursdays, quietly worried about layoff rumours."),
		  TEXT("a tall man in a grey hoodie"), FLinearColor(0.3f, 0.3f, 0.32f), { 0.65f, 0.15f, 0.55f, 0.7f, 0.6f, 0.8f, 0.45f, 0.7f, 0.6f }, 2400, 48, 70, 7.f, 9.f, 17.5f, false, true },
		{ TEXT("NPC_LENA"), TEXT("Lena"), TEXT("Park"), 27, true, TEXT("barista"), TEXT("CornerBean"), TEXT("MarloweLofts"),
		  TEXT("Opens Corner Bean most mornings. Knows every regular by their order, paints murals on weekends and hears all the neighbourhood gossip first."),
		  TEXT("a young woman with a green apron"), FLinearColor(0.1f, 0.35f, 0.18f), { 0.85f, 0.1f, 0.6f, 0.75f, 0.7f, 0.75f, 0.5f, 0.6f, 0.85f }, 600, 19, 40, 5.5f, 6.5f, 14.5f, true, true },
		{ TEXT("NPC_MARCUS"), TEXT("Marcus"), TEXT("Reyes"), 45, false, TEXT("mechanic"), TEXT("NorthgateGarage"), TEXT("DocksideFlats"),
		  TEXT("Runs the workshop floor at Northgate Garage. Proud of his restored blue hatchback, short-tempered, fiercely loyal to friends. Still fighting an insurance claim with Kestrel."),
		  TEXT("a stocky man in oil-stained overalls"), FLinearColor(0.15f, 0.2f, 0.35f), { 0.4f, 0.65f, 0.75f, 0.4f, 0.35f, 0.7f, 0.6f, 0.8f, 0.45f }, 1500, 30, 50, 6.5f, 8.f, 17.f, false, true },
		{ TEXT("NPC_AMARA"), TEXT("Amara"), TEXT("Mensah"), 31, true, TEXT("nurse"), TEXT("HarborClinic"), TEXT("HarborView"),
		  TEXT("Emergency nurse at Harbor Clinic on long shifts. Calm under pressure, checks on her elderly neighbour Victor, saving to study medicine."),
		  TEXT("a woman in blue scrubs"), FLinearColor(0.25f, 0.45f, 0.65f), { 0.7f, 0.1f, 0.7f, 0.5f, 0.95f, 0.9f, 0.55f, 0.8f, 0.55f }, 1900, 36, 55, 6.f, 7.f, 19.f, true, true },
		{ TEXT("NPC_VICTOR"), TEXT("Victor"), TEXT("Novak"), 68, false, TEXT("retired history teacher who runs the chess tables in the park"), TEXT("NeonSquare"), TEXT("HarborView"),
		  TEXT("Taught history at the district school for 35 years. Widowed, sharp, slightly nosy, plays chess in Neon Square every day and remembers everything."),
		  TEXT("an old man in a brown tweed jacket"), FLinearColor(0.35f, 0.22f, 0.12f), { 0.6f, 0.2f, 0.6f, 0.85f, 0.6f, 0.85f, 0.2f, 0.75f, 0.65f }, 3200, 6, 45, 6.5f, 10.f, 15.f, true, true },
		{ TEXT("NPC_PRIYA"), TEXT("Priya"), TEXT("Patel"), 38, true, TEXT("claims manager"), TEXT("Kestrel"), TEXT("DocksideFlats"),
		  TEXT("Claims manager at Kestrel Insurance. Ambitious, precise, sceptical of sob stories. Denied Marcus's last claim and he hasn't forgiven her."),
		  TEXT("a woman in a navy business suit"), FLinearColor(0.08f, 0.1f, 0.22f), { 0.5f, 0.35f, 0.8f, 0.45f, 0.4f, 0.6f, 0.3f, 0.5f, 0.5f }, 5200, 55, 95, 6.5f, 8.5f, 18.f, false, true },
		{ TEXT("NPC_TOMAS"), TEXT("Tomas"), TEXT("Silva"), 22, false, TEXT("student and part-time shop assistant"), TEXT("DailyMarket"), TEXT("MarloweLofts"),
		  TEXT("Engineering student working afternoons at Daily Market. Broke, restless, into street racing videos and skateboarding. Lena's flatmate."),
		  TEXT("a skinny young man in a yellow windbreaker"), FLinearColor(0.75f, 0.6f, 0.1f), { 0.7f, 0.3f, 0.45f, 0.8f, 0.5f, 0.55f, 0.8f, 0.4f, 0.8f }, 180, 15, 25, 9.5f, 12.f, 20.f, true, true },
		{ TEXT("NPC_GRACE"), TEXT("Grace"), TEXT("Bennett"), 52, true, TEXT("chef and owner"), TEXT("SaltwaterGrill"), TEXT("MarloweLofts"),
		  TEXT("Owns Saltwater Grill. Blunt, generous, works late every night, knows Marcus from school and feeds anyone who looks hungry."),
		  TEXT("a woman in a white chef's jacket"), FLinearColor(0.85f, 0.85f, 0.82f), { 0.6f, 0.45f, 0.85f, 0.35f, 0.55f, 0.85f, 0.5f, 0.75f, 0.6f }, 4100, 40, 80, 8.f, 11.f, 23.f, true, true },
		{ TEXT("NPC_HUGO"), TEXT("Hugo"), TEXT("Moreau"), 29, false, TEXT("former retail supervisor"), TEXT(""), TEXT("HarborView"),
		  TEXT("Lost his job when the electronics store closed three weeks ago. Applying everywhere, embarrassed about it, running out of savings."),
		  TEXT("a man in a creased white shirt"), FLinearColor(0.8f, 0.8f, 0.85f), { 0.55f, 0.2f, 0.3f, 0.5f, 0.6f, 0.8f, 0.35f, 0.6f, 0.4f }, 300, 20, 35, 7.5f, 9.f, 17.f, false, false },
		{ TEXT("NPC_KEIKO"), TEXT("Keiko"), TEXT("Tanaka"), 41, true, TEXT("engineering lead"), TEXT("LumenLabs"), TEXT("DocksideFlats"),
		  TEXT("Leads Daniel's team at Lumen Labs. Direct, very competent, under pressure from management to cut costs, cycles to work in any weather."),
		  TEXT("a woman in a black cycling jacket"), FLinearColor(0.05f, 0.05f, 0.06f), { 0.5f, 0.3f, 0.9f, 0.6f, 0.45f, 0.7f, 0.4f, 0.65f, 0.35f }, 7800, 70, 110, 6.f, 8.f, 18.5f, false, true },
	};

	struct FRel { const TCHAR* A; const TCHAR* B; float Aff; float Trust; float Fam; float Romance; int32 Conflicts; };
	const FRel Rels[] = {
		{ TEXT("NPC_DANIEL"), TEXT("NPC_KEIKO"), 0.3f, 0.55f, 0.6f, 0.f, 0 },
		{ TEXT("NPC_DANIEL"), TEXT("NPC_LENA"), 0.55f, 0.6f, 0.7f, 0.25f, 0 },
		{ TEXT("NPC_LENA"), TEXT("NPC_TOMAS"), 0.5f, 0.5f, 0.85f, 0.f, 0 },
		{ TEXT("NPC_MARCUS"), TEXT("NPC_PRIYA"), -0.4f, 0.1f, 0.4f, 0.f, 1 },
		{ TEXT("NPC_AMARA"), TEXT("NPC_VICTOR"), 0.6f, 0.75f, 0.7f, 0.f, 0 },
		{ TEXT("NPC_GRACE"), TEXT("NPC_LENA"), 0.3f, 0.4f, 0.4f, 0.f, 0 },
		{ TEXT("NPC_HUGO"), TEXT("NPC_DANIEL"), 0.2f, 0.35f, 0.3f, 0.f, 0 },
		{ TEXT("NPC_MARCUS"), TEXT("NPC_GRACE"), 0.45f, 0.6f, 0.75f, 0.f, 0 },
		{ TEXT("NPC_VICTOR"), TEXT("NPC_HUGO"), 0.25f, 0.4f, 0.35f, 0.f, 0 },
	};
}

TArray<ANeonNPC*> NeonRoster::SpawnAll(UWorld* World, UNeonSimSubsystem* Sim)
{
	TArray<ANeonNPC*> Out;
	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
	int32 Index = 0;
	for (const FDef& D : Defs)
	{
		const FNeonPlace* Home = Sim->FindPlace(D.Home);
		const FVector Loc = (Home ? Home->Entrance : FVector::ZeroVector) + FVector(FMath::FRandRange(-300.f, 300.f), (Index % 3 - 1) * 250.f, 120.f);
		ANeonNPC* N = World->SpawnActorDeferred<ANeonNPC>(ANeonNPC::StaticClass(), FTransform(Loc), nullptr, nullptr, ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn);
		if (!N) continue;
		UNPCIdentityComponent* Id = N->Identity;
		Id->NpcId = D.Id; Id->FirstName = D.First; Id->LastName = D.Last; Id->Age = D.Age; Id->bFemale = D.bFemale;
		Id->Occupation = D.Job; Id->WorkPlace = FName(D.Work); Id->HomePlace = FName(D.Home);
		Id->Backstory = D.Backstory; Id->Appearance = D.Appearance; Id->ClothingColor = D.Clothes;
		FNeonPersonality& P = Id->Personality;
		P.Friendliness = D.T[0]; P.Aggression = D.T[1]; P.Confidence = D.T[2]; P.Curiosity = D.T[3]; P.Empathy = D.T[4];
		P.Honesty = D.T[5]; P.RiskTolerance = D.T[6]; P.Loyalty = D.T[7]; P.Sociability = D.T[8];
		N->Needs->Money = D.Money; N->Needs->HourlyWage = D.Wage; N->Needs->DailyRent = D.Rent; N->Needs->bEmployed = D.bEmployed;
		N->Needs->Hunger = FMath::FRandRange(0.5f, 0.9f); N->Needs->Social = FMath::FRandRange(0.3f, 0.8f);
		N->FinishSpawning(FTransform(Loc));
		N->Schedule->BuildDefault(D.Wake, D.Start, D.End, D.bWeekends);
		if (!D.bEmployed) N->Schedule->OnEmploymentChanged(false);
		N->ApplyLook();

		// stable knowledge (semantic memory)
		UNPCMemoryComponent* M = N->Memory;
		if (Home) M->SetFact(TEXT("home"), FString::Printf(TEXT("I live at %s."), *Home->DisplayName), { TEXT("home"), TEXT("live") }, 0.5f);
		if (const FNeonPlace* W = Sim->FindPlace(FName(D.Work)))
			M->SetFact(TEXT("employment"), FString::Printf(TEXT("I work at %s as a %s."), *W->DisplayName, D.Job), { TEXT("job"), TEXT("work") }, 0.55f);
		else M->SetFact(TEXT("employment"), TEXT("I'm out of work and looking for a job."), { TEXT("job"), TEXT("work"), TEXT("unemployed") }, 0.8f);
		M->SetFact(TEXT("backstory"), D.Backstory, { TEXT("me"), TEXT("life") }, 0.4f);
		Out.Add(N);
		++Index;
	}
	// relationships (both directions) + what they know about each other
	auto Find = [&](const TCHAR* Id) { return Out.FindByPredicate([&](ANeonNPC* N) { return N->GetNpcId() == FName(Id); }); };
	for (const FRel& R : Rels)
	{
		ANeonNPC** A = Find(R.A); ANeonNPC** B = Find(R.B);
		if (!A || !B) continue;
		for (auto Pair : { TPair<ANeonNPC*, ANeonNPC*>(*A, *B), TPair<ANeonNPC*, ANeonNPC*>(*B, *A) })
		{
			FNeonRelationship& Rel = Pair.Key->Relationships->Get(Pair.Value->GetNpcId());
			Rel.Affinity = R.Aff; Rel.Trust = R.Trust; Rel.Familiarity = R.Fam; Rel.Romance = R.Romance; Rel.Conflicts = R.Conflicts;
			const FString Label = Pair.Key->Relationships->Label(Pair.Value->GetNpcId());
			Pair.Key->Memory->SetFact(TEXT("person:") + Pair.Value->GetNpcId().ToString(),
				FString::Printf(TEXT("%s is my %s; they're a %s."), *Pair.Value->Identity->FullName(), *Label, *Pair.Value->Identity->Occupation),
				{ Pair.Value->Identity->FirstName.ToLower(), Pair.Value->Identity->LastName.ToLower(), Label }, 0.45f);
		}
	}
	return Out;
}
