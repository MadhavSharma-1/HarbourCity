#include "NPC/NPCScheduleComponent.h"

void UNPCScheduleComponent::BuildDefault(float InWake, float InStart, float InEnd, bool bWeekend)
{
	WakeHour = InWake; WorkStartHour = InStart; WorkEndHour = InEnd; bWorksWeekends = bWeekend;
	OnEmploymentChanged(true);
}

void UNPCScheduleComponent::OnEmploymentChanged(bool bEmployed)
{
	Routine.Reset();
	const ENeonActivity Day = bEmployed ? ENeonActivity::Work : ENeonActivity::JobHunt;
	const ENeonPlaceType DayPlace = bEmployed ? ENeonPlaceType::Work : ENeonPlaceType::JobCenter;
	Routine.Add(E(0.f, ENeonActivity::Sleep, ENeonPlaceType::Home));
	Routine.Add(E(WakeHour, ENeonActivity::Leisure, ENeonPlaceType::Home));
	Routine.Add(E(WorkStartHour - 0.6f, ENeonActivity::Commute, DayPlace));
	Routine.Add(E(WorkStartHour, Day, DayPlace));
	Routine.Add(E(12.5f, ENeonActivity::Lunch, ENeonPlaceType::Cafe));
	Routine.Add(E(13.4f, Day, DayPlace));
	if (!bEmployed) Routine.Add(E(15.f, ENeonActivity::Wander, ENeonPlaceType::Park)); // cheaper afternoons
	Routine.Add(E(WorkEndHour, ENeonActivity::Commute, ENeonPlaceType::Home));
	Routine.Add(E(WorkEndHour + 1.f, ENeonActivity::Shop, ENeonPlaceType::Shop));
	Routine.Add(E(WorkEndHour + 1.6f, ENeonActivity::Leisure, bEmployed ? ENeonPlaceType::Restaurant : ENeonPlaceType::Park));
	Routine.Add(E(21.5f, ENeonActivity::Leisure, ENeonPlaceType::Home));
	Routine.Add(E(23.f, ENeonActivity::Sleep, ENeonPlaceType::Home));
	Routine.Sort([](const FNeonScheduleEntry& A, const FNeonScheduleEntry& B) { return A.StartHour < B.StartHour; });
}

const FNeonScheduleEntry& UNPCScheduleComponent::PlannedAt(float Hour, int32 Day) const
{
	static FNeonScheduleEntry Idle;
	if (Routine.Num() == 0) return Idle;
	// deterministic per-day jitter of up to ±30 minutes
	const float Jitter = (FMath::Frac(FMath::Sin((Day + 1) * 12.9898f + GetOwner()->GetUniqueID() * 0.371f) * 43758.5453f) - 0.5f);
	const float H = Hour - Jitter;
	const bool bWeekend = (Day % 7) >= 5;
	const FNeonScheduleEntry* Best = &Routine[0];
	for (const FNeonScheduleEntry& En : Routine) if (En.StartHour <= H) Best = &En;
	if (bWeekend && !bWorksWeekends && (Best->Activity == ENeonActivity::Work || Best->Activity == ENeonActivity::JobHunt || (Best->Activity == ENeonActivity::Commute && Best->PlaceType != ENeonPlaceType::Home)))
	{
		static FNeonScheduleEntry Weekend; Weekend.Activity = ENeonActivity::Leisure; Weekend.PlaceType = ENeonPlaceType::Park;
		return Weekend;
	}
	return *Best;
}
