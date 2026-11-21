#include "World/NeonCityGenerator.h"
#include "World/NeonMaterials.h"
#include "Core/NeonSimSubsystem.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SceneComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

ANeonCityGenerator::ANeonCityGenerator()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cyl(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Sph(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	CubeMesh = Cube.Object; CylinderMesh = Cyl.Object; SphereMesh = Sph.Object;
}

UInstancedStaticMeshComponent* ANeonCityGenerator::NewISM(const FName& Name, UStaticMesh* Mesh, UMaterialInterface* Mat, const FName& Tag, bool bCollide)
{
	UInstancedStaticMeshComponent* ISM = NewObject<UInstancedStaticMeshComponent>(this, Name);
	ISM->SetupAttachment(RootComponent);
	ISM->SetStaticMesh(Mesh);
	if (Mat) ISM->SetMaterial(0, Mat);
	ISM->SetCollisionEnabled(bCollide ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
	if (bCollide) ISM->SetCollisionProfileName(TEXT("BlockAll"));
	if (!Tag.IsNone()) ISM->ComponentTags.Add(Tag);
	ISM->RegisterComponent();
	Instancers.Add(ISM);
	return ISM;
}

void ANeonCityGenerator::Box(UInstancedStaticMeshComponent* ISM, const FVector& Center, const FVector& Size, float Yaw)
{
	// engine cube is 100 cm, centred on its pivot
	ISM->AddInstance(FTransform(FRotator(0, Yaw, 0), Center, Size / 100.f), /*bWorldSpace*/ true);
}

FNeonPlace& ANeonCityGenerator::AddBuilding(UNeonSimSubsystem* Sim, FName Id, const FString& Name, ENeonPlaceType Type, const FVector& C, const FVector& Size,
	const FLinearColor& Color, const FVector& Door, float Open, float Close, float Price)
{
	UInstancedStaticMeshComponent*& Facade = FacadeByColor.FindOrAdd(Color);
	if (!Facade) Facade = NewISM(*FString::Printf(TEXT("Facade_%d"), FacadeByColor.Num()), CubeMesh, NeonMaterials::Surface(this, Color, 0.8f), TEXT("Building"), true);
	Box(Facade, C + FVector(0, 0, Size.Z * 0.5f + 15.f), Size);
	// window bands on all four facades, one row per 3.5 m floor
	const int32 Floors = FMath::Max(1, FMath::FloorToInt(Size.Z / 350.f));
	for (int32 F = 0; F < Floors; ++F)
	{
		const float Z = 15.f + F * 350.f + 190.f;
		for (int32 Side = 0; Side < 4; ++Side)
		{
			const bool bX = Side < 2;
			const float Sgn = (Side % 2 == 0) ? 1.f : -1.f;
			const float Len = bX ? Size.Y : Size.X;
			const int32 Cols = FMath::Max(1, FMath::FloorToInt(Len / 320.f));
			for (int32 K = 0; K < Cols; ++K)
			{
				if (FMath::FRand() < 0.12f) continue;
				const float T = -Len * 0.5f + (K + 0.5f) * Len / Cols;
				const FVector P = bX ? FVector(Sgn * (Size.X * 0.5f + 2.f), T, Z) : FVector(T, Sgn * (Size.Y * 0.5f + 2.f), Z);
				const FVector S = bX ? FVector(6.f, 190.f, 170.f) : FVector(190.f, 6.f, 170.f);
				Box(Windows, C + P, S);
			}
		}
	}
	FNeonPlace& P = Sim->Places.AddDefaulted_GetRef();
	P.Id = Id; P.DisplayName = Name; P.Type = Type; P.Center = C;
	P.Entrance = C + Door * (FVector::DotProduct(Door.GetAbs(), Size) * 0.5f + 180.f);
	P.OpenHour = Open; P.CloseHour = Close; P.Price = Price;
	return P;
}

void ANeonCityGenerator::Build(UNeonSimSubsystem* Sim)
{
	const FLinearColor Asphalt(0.045f, 0.045f, 0.05f), Concrete(0.42f, 0.41f, 0.39f), Grass(0.08f, 0.2f, 0.05f);
	UInstancedStaticMeshComponent* Ground = NewISM(TEXT("Ground"), CubeMesh, NeonMaterials::Surface(this, Asphalt, 0.85f), TEXT("Ground"), true);
	UInstancedStaticMeshComponent* Walks = NewISM(TEXT("Sidewalks"), CubeMesh, NeonMaterials::Surface(this, Concrete, 0.9f), TEXT("Ground"), true);
	UInstancedStaticMeshComponent* Lawn = NewISM(TEXT("Lawn"), CubeMesh, NeonMaterials::Surface(this, Grass, 1.f), TEXT("Grass"), true);
	UInstancedStaticMeshComponent* Paint = NewISM(TEXT("RoadPaint"), CubeMesh, NeonMaterials::Surface(this, FLinearColor(0.75f, 0.75f, 0.7f), 0.6f), NAME_None, false);
	UInstancedStaticMeshComponent* Yellow = NewISM(TEXT("RoadPaintYellow"), CubeMesh, NeonMaterials::Surface(this, FLinearColor(0.8f, 0.55f, 0.05f), 0.6f), NAME_None, false);
	Windows = NewISM(TEXT("Windows"), CubeMesh, nullptr, NAME_None, false);
	WindowGlow = NeonMaterials::Glow(this, FLinearColor(0.06f, 0.08f, 0.1f), 0.f);
	Windows->SetMaterial(0, WindowGlow);
	UInstancedStaticMeshComponent* Poles = NewISM(TEXT("LampPoles"), CylinderMesh, NeonMaterials::Surface(this, FLinearColor(0.05f, 0.05f, 0.055f), 0.4f, 0.8f), TEXT("Lamp"), true);
	UInstancedStaticMeshComponent* Heads = NewISM(TEXT("LampHeads"), CubeMesh, nullptr, NAME_None, false);
	LampGlow = NeonMaterials::Glow(this, FLinearColor(1.f, 0.78f, 0.5f), 0.f);
	Heads->SetMaterial(0, LampGlow);
	UInstancedStaticMeshComponent* Trunks = NewISM(TEXT("Trunks"), CylinderMesh, NeonMaterials::Surface(this, FLinearColor(0.12f, 0.08f, 0.05f), 1.f), TEXT("Tree"), true);
	UInstancedStaticMeshComponent* Crowns = NewISM(TEXT("Crowns"), TreeMeshOverride.IsNull() ? SphereMesh : TreeMeshOverride.LoadSynchronous(), NeonMaterials::Surface(this, FLinearColor(0.05f, 0.16f, 0.04f), 0.9f), NAME_None, false);
	UInstancedStaticMeshComponent* Props = NewISM(TEXT("Props"), CubeMesh, NeonMaterials::Surface(this, FLinearColor(0.3f, 0.18f, 0.1f), 0.8f), NAME_None, true);

	// ground, sidewalks (15 cm kerbs), lane markings
	const float Extent = 4.f * Cell;
	Box(Ground, FVector(0, 0, -10), FVector(Extent + 20000.f, Extent + 20000.f, 20.f));
	for (int32 I = 0; I < 3; ++I) for (int32 J = 0; J < 3; ++J)
		Box(Walks, BlockCenter(I, J) + FVector(0, 0, 7.5f), FVector(BlockHalf * 2.f, BlockHalf * 2.f, 15.f));
	for (int32 R = 0; R < 4; ++R)
	{
		const float RC = (R - 1.5f) * Cell;
		for (int32 Seg = 0; Seg < 3; ++Seg)
		{
			const float From = (Seg - 1) * Cell - BlockHalf + 900.f, To = (Seg - 1) * Cell + BlockHalf - 900.f;
			Box(Yellow, FVector((From + To) * 0.5f, RC, 1.f), FVector(To - From, 24.f, 2.f));       // roads along X
			Box(Yellow, FVector(RC, (From + To) * 0.5f, 1.f), FVector(24.f, To - From, 2.f));       // roads along Y
			for (float T = From; T < To; T += 900.f)
			{
				Box(Paint, FVector(T + 150.f, RC + 350.f, 1.f), FVector(300.f, 14.f, 2.f)); Box(Paint, FVector(T + 150.f, RC - 350.f, 1.f), FVector(300.f, 14.f, 2.f));
				Box(Paint, FVector(RC + 350.f, T + 150.f, 1.f), FVector(14.f, 300.f, 2.f)); Box(Paint, FVector(RC - 350.f, T + 150.f, 1.f), FVector(14.f, 300.f, 2.f));
			}
		}
		// zebra crossings at each intersection approach
		for (int32 R2 = 0; R2 < 4; ++R2)
		{
			const FVector X((R - 1.5f) * Cell, (R2 - 1.5f) * Cell, 1.f);
			for (int32 K = 0; K < 10; ++K)
			{
				const float O = -630.f + K * 140.f;
				for (float S : { -1.f, 1.f })
				{
					Box(Paint, X + FVector(S * 850.f, O, 0), FVector(260.f, 60.f, 2.f));
					Box(Paint, X + FVector(O, S * 850.f, 0), FVector(60.f, 260.f, 2.f));
				}
			}
		}
	}

	// buildings & places — X is north, Y is east
	const FVector N(1, 0, 0), S(-1, 0, 0);
	auto Half = [&](int32 I, int32 J, bool bNorth) { return BlockCenter(I, J) + FVector(bNorth ? 1350.f : -1350.f, 0, 0); };
	const FVector HalfSize(2300.f, 5000.f, 0.f);
	AddBuilding(Sim, TEXT("HarborView"), TEXT("Harbor View Apartments"), ENeonPlaceType::Home, BlockCenter(0, 0), FVector(5000, 5000, 4200), FLinearColor(0.55f, 0.5f, 0.44f), N, 0, 24, 0);
	AddBuilding(Sim, TEXT("LumenLabs"), TEXT("Lumen Labs"), ENeonPlaceType::Work, BlockCenter(1, 0), FVector(5000, 5000, 6300), FLinearColor(0.16f, 0.24f, 0.3f), N, 7, 20, 0);
	AddBuilding(Sim, TEXT("JobCenter"), TEXT("City Job Centre"), ENeonPlaceType::JobCenter, Half(2, 0, false), HalfSize + FVector(0, 0, 1050), FLinearColor(0.5f, 0.52f, 0.55f), S, 9, 17, 0);
	AddBuilding(Sim, TEXT("CornerBean"), TEXT("Corner Bean"), ENeonPlaceType::Cafe, Half(0, 1, true), HalfSize + FVector(0, 0, 700), FLinearColor(0.42f, 0.2f, 0.12f), N, 6, 18, 8);
	AddBuilding(Sim, TEXT("MarloweLofts"), TEXT("Marlowe Street Lofts"), ENeonPlaceType::Home, Half(0, 1, false), HalfSize + FVector(0, 0, 2100), FLinearColor(0.6f, 0.3f, 0.22f), S, 0, 24, 0);
	AddBuilding(Sim, TEXT("SaltwaterGrill"), TEXT("Saltwater Grill"), ENeonPlaceType::Restaurant, Half(2, 1, true), HalfSize + FVector(0, 0, 700), FLinearColor(0.2f, 0.3f, 0.35f), N, 11, 23, 32);
	AddBuilding(Sim, TEXT("Kestrel"), TEXT("Kestrel Insurance"), ENeonPlaceType::Work, Half(2, 1, false), HalfSize + FVector(0, 0, 3500), FLinearColor(0.7f, 0.68f, 0.62f), S, 8, 18, 0);
	AddBuilding(Sim, TEXT("DocksideFlats"), TEXT("Dockside Flats"), ENeonPlaceType::Home, Half(0, 2, true), HalfSize + FVector(0, 0, 2800), FLinearColor(0.35f, 0.38f, 0.4f), N, 0, 24, 0);
	AddBuilding(Sim, TEXT("DailyMarket"), TEXT("Daily Market"), ENeonPlaceType::Shop, Half(0, 2, false), HalfSize + FVector(0, 0, 500), FLinearColor(0.15f, 0.35f, 0.2f), S, 7, 22, 25);
	AddBuilding(Sim, TEXT("HarborClinic"), TEXT("Harbor Clinic"), ENeonPlaceType::Work, Half(1, 2, true), HalfSize + FVector(0, 0, 1750), FLinearColor(0.85f, 0.85f, 0.83f), N, 0, 24, 0);
	AddBuilding(Sim, TEXT("NorthgateGarage"), TEXT("Northgate Garage"), ENeonPlaceType::Work, Half(2, 2, true), HalfSize + FVector(0, 0, 900), FLinearColor(0.45f, 0.3f, 0.18f), N, 8, 18, 0);
	AddBuilding(Sim, TEXT("VinylCo"), TEXT("Vinyl & Co"), ENeonPlaceType::Shop, Half(2, 2, false), HalfSize + FVector(0, 0, 600), FLinearColor(0.4f, 0.12f, 0.3f), S, 10, 20, 18);
	AddBuilding(Sim, TEXT("BlueDoor"), TEXT("Blue Door Bar"), ENeonPlaceType::Restaurant, Half(1, 2, false), HalfSize + FVector(0, 0, 600), FLinearColor(0.1f, 0.15f, 0.4f), S, 17, 2, 14);

	// gas station (north half of block (2,0)): canopy on pillars, pumps
	{
		const FVector C = Half(2, 0, true);
		UInstancedStaticMeshComponent* Gas = NewISM(TEXT("GasStation"), CubeMesh, NeonMaterials::Surface(this, FLinearColor(0.75f, 0.1f, 0.08f), 0.5f), TEXT("Building"), true);
		Box(Gas, C + FVector(0, 0, 560), FVector(1600, 2400, 60));
		for (float X : { -650.f, 650.f }) for (float Y : { -1050.f, 1050.f }) Box(Gas, C + FVector(X, Y, 280), FVector(40, 40, 540));
		for (float Y : { -500.f, 500.f }) Box(Props, C + FVector(0, Y, 100), FVector(90, 60, 180));
		FNeonPlace& P = Sim->Places.AddDefaulted_GetRef();
		P.Id = TEXT("BaylineFuel"); P.DisplayName = TEXT("Bayline Fuel"); P.Type = ENeonPlaceType::GasStation;
		P.Center = C; P.Entrance = C + FVector(1300, 0, 0); P.OpenHour = 0; P.CloseHour = 24; P.Price = Sim->CityFuelPrice;
	}
	// park: lawn, trees, benches, fountain
	{
		const FVector C = BlockCenter(1, 1);
		Box(Lawn, C + FVector(0, 0, 18), FVector(5200, 5200, 6));
		Box(Walks, C + FVector(0, 0, 19), FVector(5200, 400, 6));
		Box(Walks, C + FVector(0, 0, 19), FVector(400, 5200, 6));
		UInstancedStaticMeshComponent* Fountain = NewISM(TEXT("Fountain"), CylinderMesh, NeonMaterials::Surface(this, FLinearColor(0.6f, 0.6f, 0.58f), 0.6f), TEXT("Building"), true);
		Fountain->AddInstance(FTransform(FRotator::ZeroRotator, C + FVector(0, 0, 60), FVector(7.f, 7.f, 0.9f)), true);
		Fountain->AddInstance(FTransform(FRotator::ZeroRotator, C + FVector(0, 0, 160), FVector(0.8f, 0.8f, 2.5f)), true);
		for (int32 K = 0; K < 26; ++K)
		{
			const FVector P = C + FVector(FMath::FRandRange(-2300.f, 2300.f), FMath::FRandRange(-2300.f, 2300.f), 0);
			if (FMath::Abs(P.X - C.X) < 450.f || FMath::Abs(P.Y - C.Y) < 450.f || FVector::Dist2D(P, C) < 900.f) continue;
			const float Sc = FMath::FRandRange(0.8f, 1.4f);
			Trunks->AddInstance(FTransform(FRotator::ZeroRotator, P + FVector(0, 0, 200 * Sc), FVector(0.35f, 0.35f, 4.f) * Sc), true);
			Crowns->AddInstance(FTransform(FRotator(0, FMath::FRandRange(0.f, 360.f), 0), P + FVector(0, 0, 520 * Sc), FVector(4.f, 4.f, 4.6f) * Sc), true);
		}
		for (int32 K = 0; K < 8; ++K)
		{
			const float A = K * PI / 4.f;
			Box(Props, C + FVector(FMath::Cos(A) * 1300.f, FMath::Sin(A) * 1300.f, 45.f), FVector(60, 180, 45), FMath::RadiansToDegrees(A));
		}
		FNeonPlace& P = Sim->Places.AddDefaulted_GetRef();
		P.Id = TEXT("NeonSquare"); P.DisplayName = TEXT("Neon Square park"); P.Type = ENeonPlaceType::Park;
		P.Center = C; P.Entrance = C + FVector(BlockHalf - 150.f, 0, 0); P.OpenHour = 0; P.CloseHour = 24;
	}
	// street trees + lights along every block edge
	for (int32 I = 0; I < 3; ++I) for (int32 J = 0; J < 3; ++J)
	{
		const FVector C = BlockCenter(I, J);
		for (int32 Side = 0; Side < 4; ++Side)
		{
			const FVector Out = Side == 0 ? FVector(1, 0, 0) : Side == 1 ? FVector(-1, 0, 0) : Side == 2 ? FVector(0, 1, 0) : FVector(0, -1, 0);
			const FVector Along(Out.Y, Out.X, 0);
			for (float T : { -1800.f, 0.f, 1800.f })
			{
				const FVector Edge = C + Out * (BlockHalf - 60.f) + Along * T;
				if (T == 0.f)
				{
					Poles->AddInstance(FTransform(FRotator::ZeroRotator, Edge + FVector(0, 0, 400), FVector(0.18f, 0.18f, 8.f)), true);
					Box(Heads, Edge + Out * 60.f + FVector(0, 0, 790), FVector(90, 90, 22));
					if ((I + J + Side) % 2 == 0)
					{
						UPointLightComponent* L = NewObject<UPointLightComponent>(this);
						L->SetupAttachment(RootComponent);
						L->SetWorldLocation(Edge + Out * 60.f + FVector(0, 0, 760));
						L->SetIntensityUnits(ELightUnits::Candelas);
						L->SetIntensity(0.f);
						L->SetAttenuationRadius(2200.f);
						L->SetLightColor(FLinearColor(1.f, 0.8f, 0.55f));
						L->SetCastShadows(false);
						L->RegisterComponent();
						StreetLights.Add(L);
					}
				}
				else
				{
					const FVector P = C + Out * (BlockHalf - 320.f) + Along * T;
					Trunks->AddInstance(FTransform(FRotator::ZeroRotator, P + FVector(0, 0, 160), FVector(0.25f, 0.25f, 3.2f)), true);
					Crowns->AddInstance(FTransform(FRotator::ZeroRotator, P + FVector(0, 0, 420), FVector(2.8f, 2.8f, 3.2f)), true);
				}
			}
		}
	}
	BuildWaypoints(Sim);
}

void ANeonCityGenerator::BuildWaypoints(UNeonSimSubsystem* Sim)
{
	// 8 nodes per block on the sidewalk ring (corners + edge midpoints), linked around the ring,
	// with crosswalk links between facing corners of neighbouring blocks.
	const float In = BlockHalf - 150.f;
	const FVector2D Ring[8] = { {In, -In}, {In, 0}, {In, In}, {0, In}, {-In, In}, {-In, 0}, {-In, -In}, {0, -In} };
	auto Id = [](int32 I, int32 J, int32 K) { return (I * 3 + J) * 8 + K; };
	Sim->Waypoints.SetNum(72);
	Sim->Links.SetNum(72);
	for (int32 I = 0; I < 3; ++I) for (int32 J = 0; J < 3; ++J)
		for (int32 K = 0; K < 8; ++K)
		{
			Sim->Waypoints[Id(I, J, K)] = BlockCenter(I, J) + FVector(Ring[K].X, Ring[K].Y, 20.f);
			Sim->Links[Id(I, J, K)].AddUnique(Id(I, J, (K + 1) % 8));
			Sim->Links[Id(I, J, (K + 1) % 8)].AddUnique(Id(I, J, K));
		}
	auto Link = [&](int32 A, int32 B) { Sim->Links[A].AddUnique(B); Sim->Links[B].AddUnique(A); };
	for (int32 I = 0; I < 3; ++I) for (int32 J = 0; J < 3; ++J)
	{
		if (I + 1 < 3) { Link(Id(I, J, 0), Id(I + 1, J, 6)); Link(Id(I, J, 2), Id(I + 1, J, 4)); }   // crossing northwards
		if (J + 1 < 3) { Link(Id(I, J, 2), Id(I, J + 1, 0)); Link(Id(I, J, 4), Id(I, J + 1, 6)); }   // crossing eastwards
	}
}

void ANeonCityGenerator::SetNight(float Night)
{
	for (UPointLightComponent* L : StreetLights) L->SetIntensity(Night * 900.f);
	if (LampGlow) LampGlow->SetScalarParameterValue(TEXT("Glow"), Night * 60.f);
	if (WindowGlow)
	{
		WindowGlow->SetVectorParameterValue(TEXT("Color"), FMath::Lerp(FLinearColor(0.05f, 0.07f, 0.09f), FLinearColor(1.f, 0.72f, 0.4f), Night));
		WindowGlow->SetScalarParameterValue(TEXT("Glow"), Night * 6.f);
		WindowGlow->SetScalarParameterValue(TEXT("Roughness"), FMath::Lerp(0.05f, 0.6f, Night));
		WindowGlow->SetScalarParameterValue(TEXT("Metallic"), FMath::Lerp(0.8f, 0.f, Night));
	}
}
